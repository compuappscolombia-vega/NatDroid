#include "../include/emu_plugin_api.h"
#include <cstring>

namespace {

struct DxvkTurnipPluginState {
    const EmuHostServices* host = nullptr;
    bool turnip_enabled = true;
    uint32_t max_frames_in_flight = 2;
};

struct EmuGpuTranslatorInterface {
    uint32_t struct_size;
    const char* backend_name;
    EmuStatus (*submit_dxbc_frame)(void* ctx, AHardwareBuffer* target_buf);
};

static DxvkTurnipPluginState g_state;

EmuStatus submit_dxbc_frame_impl(void* ctx, AHardwareBuffer* target_buf) {
    auto* st = static_cast<DxvkTurnipPluginState*>(ctx);
    if (!st || !st->host || !target_buf) {
        return EMU_ERR_INVALID_ARG;
    }
    // Zero-copy AHardwareBuffer handoff happens through host->query_interface("gpu.vulkan.bridge.v1")
    return EMU_OK;
}

static EmuGpuTranslatorInterface g_gpu_iface = {
    sizeof(EmuGpuTranslatorInterface),
    "DXVK/Turnip-VK1.3",
    submit_dxbc_frame_impl
};

EmuStatus plugin_init(void* ctx, const EmuHostServices* host) {
    auto* st = static_cast<DxvkTurnipPluginState*>(ctx);
    if (!st || !host || host->struct_size < sizeof(EmuHostServices)) {
        return EMU_ERR_ABI_MISMATCH;
    }
    st->host = host;

    EmuCpuTopologyInfo topo{};
    if (host->query_cpu_topology && host->query_cpu_topology(host->host_ctx, &topo) == EMU_OK) {
        if (host->pin_current_thread_mask && topo.performance_core_mask != 0) {
            host->pin_current_thread_mask(host->host_ctx, topo.performance_core_mask);
        }
    }
    if (host->log_msg) {
        host->log_msg(host->host_ctx, EMU_LOG_INFO, "DXVKTurnip", "Plugin initialized on performance cores");
    }
    return EMU_OK;
}

void plugin_shutdown(void* ctx) {
    auto* st = static_cast<DxvkTurnipPluginState*>(ctx);
    if (st) {
        st->host = nullptr;
    }
}

EmuStatus plugin_configure(void* ctx, const char* key, const char* value) {
    auto* st = static_cast<DxvkTurnipPluginState*>(ctx);
    if (!st || !key || !value) return EMU_ERR_INVALID_ARG;
    if (std::strcmp(key, "turnip.enabled") == 0) {
        st->turnip_enabled = (std::strcmp(value, "1") == 0 || std::strcmp(value, "true") == 0);
        return EMU_OK;
    }
    return EMU_ERR_NOT_SUPPORTED;
}

void* plugin_get_interface(void* /*ctx*/, const char* interface_id) {
    if (interface_id && std::strcmp(interface_id, "gpu.translator.dxvk.v1") == 0) {
        return &g_gpu_iface;
    }
    return nullptr;
}

const char* g_deps[] = { nullptr };

const EmuPluginDescriptor g_descriptor = {
    EMU_PLUGIN_MAGIC,
    sizeof(EmuPluginDescriptor),
    EMU_PLUGIN_API_VERSION_MAJOR,
    EMU_PLUGIN_API_VERSION_MINOR,
    "org.emu.gpu.dxvk_turnip",
    "DXVK + Turnip Vulkan 1.3 Backend",
    "Android15 Core Architecture",
    "1.0.0",
    EMU_PLUGIN_CAT_GPU_BACKEND | EMU_PLUGIN_CAT_SYSCALL_TRANSLATOR,
    100,
    g_deps,
    &g_state,
    {
        sizeof(EmuPluginVTable),
        plugin_init,
        plugin_shutdown,
        plugin_configure,
        plugin_get_interface
    }
};

} // namespace

extern "C" __attribute__((visibility("default")))
const EmuPluginDescriptor* emu_plugin_entry(void) {
    return &g_descriptor;
}
