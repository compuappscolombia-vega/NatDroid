#include <jni.h>
#include <android/native_window_jni.h>
#include <android/performance_hint.h>
#include <cstdint>
#include <memory>
#include <string>

#include "../include/emu_plugin_api.h"
#include "../cpp_core/hw_driver_hal.hpp"
#include "../cpp_core/gpu_vulkan_bridge.hpp"

extern "C" {
    struct HostRegistryHandle;
    EmuStatus emu_rust_registry_load(HostRegistryHandle* handle, const char* so_path);
    EmuStatus emu_rust_registry_init_all(HostRegistryHandle* handle);
    void emu_rust_registry_destroy(HostRegistryHandle* handle);

    struct EmuRawInputPacket {
        uint64_t timestamp_ns;
        uint32_t device_id;
        uint16_t event_type;
        uint16_t code;
        int32_t value;
    };
    bool emu_input_ring_push(EmuRawInputPacket pkt);
}

namespace emu::core {
    struct CoreContext {
        emu::hal::HardwareDriverHal hal;
        emu::gpu::VulkanGpuBridge gpu;
        HostRegistryHandle* rust_registry = nullptr;
        EmuHostServices host_services{};
    };
    std::unique_ptr<CoreContext> create_core_context(APerformanceHintManager* hint_mgr, int64_t target_frame_ns);
}

extern "C" JNIEXPORT jlong JNICALL
Java_org_emu_android15_NativeBridge_nativeCreateRuntime(
    JNIEnv* /*env*/,
    jobject /*thiz*/,
    jlong targetFrameNs
) {
    APerformanceHintManager* hint_mgr = APerformanceHint_getManager();
    auto ctx = emu::core::create_core_context(hint_mgr, static_cast<int64_t>(targetFrameNs));
    return reinterpret_cast<jlong>(ctx.release());
}

extern "C" JNIEXPORT jint JNICALL
Java_org_emu_android15_NativeBridge_nativeLoadPlugin(
    JNIEnv* env,
    jobject /*thiz*/,
    jlong runtimePtr,
    jstring pluginSoPath
) {
    auto* ctx = reinterpret_cast<emu::core::CoreContext*>(runtimePtr);
    if (!ctx || !pluginSoPath) return EMU_ERR_INVALID_ARG;

    const char* path_cstr = env->GetStringUTFChars(pluginSoPath, nullptr);
    EmuStatus st = emu_rust_registry_load(ctx->rust_registry, path_cstr);
    env->ReleaseStringUTFChars(pluginSoPath, path_cstr);
    return static_cast<jint>(st);
}

extern "C" JNIEXPORT jint JNICALL
Java_org_emu_android15_NativeBridge_nativeInitializePlugins(
    JNIEnv* /*env*/,
    jobject /*thiz*/,
    jlong runtimePtr
) {
    auto* ctx = reinterpret_cast<emu::core::CoreContext*>(runtimePtr);
    if (!ctx) return EMU_ERR_INVALID_ARG;
    return static_cast<jint>(emu_rust_registry_init_all(ctx->rust_registry));
}

extern "C" JNIEXPORT jint JNICALL
Java_org_emu_android15_NativeBridge_nativeAttachGpuSurface(
    JNIEnv* env,
    jobject /*thiz*/,
    jlong runtimePtr,
    jobject androidSurface,
    jint width,
    jint height,
    jstring customIcdPath,
    jstring pipelineCachePath
) {
    auto* ctx = reinterpret_cast<emu::core::CoreContext*>(runtimePtr);
    if (!ctx || !androidSurface) return EMU_ERR_INVALID_ARG;

    ANativeWindow* window = ANativeWindow_fromSurface(env, androidSurface);
    if (!window) return EMU_ERR_INVALID_ARG;

    const char* icd_cstr = customIcdPath ? env->GetStringUTFChars(customIcdPath, nullptr) : nullptr;
    const char* cache_cstr = pipelineCachePath ? env->GetStringUTFChars(pipelineCachePath, nullptr) : nullptr;

    EmuGpuSurfaceDesc desc{};
    desc.native_window = window;
    desc.width = static_cast<uint32_t>(width);
    desc.height = static_cast<uint32_t>(height);
    desc.prefer_mailbox_present = 1;
    desc.custom_icd_path = icd_cstr;

    EmuStatus st = ctx->gpu.initialize(desc, cache_cstr);

    if (icd_cstr) env->ReleaseStringUTFChars(customIcdPath, icd_cstr);
    if (cache_cstr) env->ReleaseStringUTFChars(pipelineCachePath, cache_cstr);
    ANativeWindow_release(window);
    return static_cast<jint>(st);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_org_emu_android15_NativeBridge_nativePushInputEvent(
    JNIEnv* /*env*/,
    jobject /*thiz*/,
    jlong timestampNs,
    jint deviceId,
    jint eventType,
    jint code,
    jint value
) {
    EmuRawInputPacket pkt{
        static_cast<uint64_t>(timestampNs),
        static_cast<uint32_t>(deviceId),
        static_cast<uint16_t>(eventType),
        static_cast<uint16_t>(code),
        static_cast<int32_t>(value)
    };
    return emu_input_ring_push(pkt) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_org_emu_android15_NativeBridge_nativeDestroyRuntime(
    JNIEnv* /*env*/,
    jobject /*thiz*/,
    jlong runtimePtr
) {
    auto* ctx = reinterpret_cast<emu::core::CoreContext*>(runtimePtr);
    if (!ctx) return;
    emu_rust_registry_destroy(ctx->rust_registry);
    ctx->gpu.shutdown();
    ctx->hal.shutdown();
    delete ctx;
}
