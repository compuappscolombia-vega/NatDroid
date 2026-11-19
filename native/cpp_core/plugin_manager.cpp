#include "../include/emu_plugin_api.h"
#include "hw_driver_hal.hpp"
#include "gpu_vulkan_bridge.hpp"

#include <android/log.h>
#include <memory>

extern "C" {
    struct HostRegistryHandle;
    HostRegistryHandle* emu_rust_registry_create(const void* host_services_ptr);
    EmuStatus emu_rust_registry_load(HostRegistryHandle* handle, const char* so_path);
    EmuStatus emu_rust_registry_init_all(HostRegistryHandle* handle);
    void* emu_rust_registry_query_interface(HostRegistryHandle* handle, const char* interface_id);
    void emu_rust_registry_destroy(HostRegistryHandle* handle);
}

namespace emu::core {

struct CoreContext {
    emu::hal::HardwareDriverHal hal;
    emu::gpu::VulkanGpuBridge gpu;
    HostRegistryHandle* rust_registry = nullptr;
    EmuHostServices host_services{};
};

static void host_log_msg(void*, EmuLogLevel level, const char* tag, const char* msg) {
    int prio = ANDROID_LOG_INFO;
    switch (level) {
        case EMU_LOG_ERROR: prio = ANDROID_LOG_ERROR; break;
        case EMU_LOG_WARN:  prio = ANDROID_LOG_WARN; break;
        case EMU_LOG_DEBUG: prio = ANDROID_LOG_DEBUG; break;
        default: break;
    }
    __android_log_print(prio, tag ? tag : "EmuCore", "%s", msg ? msg : "");
}

static EmuStatus host_alloc_hw_buffer(
    void* ctx, uint32_t w, uint32_t h, uint32_t fmt, uint64_t usage, AHardwareBuffer** out_buf
) {
    return static_cast<CoreContext*>(ctx)->hal.allocate_hardware_buffer(w, h, fmt, usage, out_buf);
}

static void host_release_hw_buffer(void* ctx, AHardwareBuffer* buf) {
    static_cast<CoreContext*>(ctx)->hal.release_hardware_buffer(buf);
}

static EmuStatus host_query_cpu_topology(void* ctx, EmuCpuTopologyInfo* out_info) {
    if (!out_info) return EMU_ERR_INVALID_ARG;
    *out_info = static_cast<CoreContext*>(ctx)->hal.query_cpu_topology();
    return EMU_OK;
}

static EmuStatus host_pin_thread_mask(void* ctx, uint32_t mask) {
    return static_cast<CoreContext*>(ctx)->hal.pin_current_thread(mask);
}

static EmuStatus host_report_adpf(void* ctx, int64_t actual_ns, int64_t /*target_ns*/) {
    return static_cast<CoreContext*>(ctx)->hal.report_work_duration(actual_ns);
}

static void* host_query_interface(void* ctx, const char* iface_id) {
    auto* core = static_cast<CoreContext*>(ctx);
    return emu_rust_registry_query_interface(core->rust_registry, iface_id);
}

std::unique_ptr<CoreContext> create_core_context(APerformanceHintManager* hint_mgr, int64_t target_frame_ns) {
    auto ctx = std::make_unique<CoreContext>();
    ctx->hal.initialize(hint_mgr, target_frame_ns);

    ctx->host_services.struct_size = sizeof(EmuHostServices);
    ctx->host_services.api_version_major = EMU_PLUGIN_API_VERSION_MAJOR;
    ctx->host_services.api_version_minor = EMU_PLUGIN_API_VERSION_MINOR;
    ctx->host_services.log_msg = host_log_msg;
    ctx->host_services.alloc_hw_buffer = host_alloc_hw_buffer;
    ctx->host_services.release_hw_buffer = host_release_hw_buffer;
    ctx->host_services.query_cpu_topology = host_query_cpu_topology;
    ctx->host_services.pin_current_thread_mask = host_pin_thread_mask;
    ctx->host_services.report_adpf_work_duration = host_report_adpf;
    ctx->host_services.query_interface = host_query_interface;
    ctx->host_services.host_ctx = ctx.get();

    ctx->rust_registry = emu_rust_registry_create(&ctx->host_services);
    return ctx;
}

} // namespace emu::core
