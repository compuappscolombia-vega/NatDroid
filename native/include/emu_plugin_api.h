#ifndef EMU_PLUGIN_API_H
#define EMU_PLUGIN_API_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define EMU_PLUGIN_MAGIC 0x454D5535u /* "EMU5" */
#define EMU_PLUGIN_API_VERSION_MAJOR 1u
#define EMU_PLUGIN_API_VERSION_MINOR 0u

typedef enum EmuPluginCategory {
    EMU_PLUGIN_CAT_BINARY_LOADER      = 1u << 0, /* PE32+, ELF64, x86_64 JIT/Dynarec */
    EMU_PLUGIN_CAT_SYSCALL_TRANSLATOR = 1u << 1, /* Win32 NT -> Linux syscall bridge */
    EMU_PLUGIN_CAT_GPU_BACKEND        = 1u << 2, /* Vulkan 1.3 / Turnip / DXVK / VKD3D */
    EMU_PLUGIN_CAT_HW_DRIVER_HAL      = 1u << 3, /* CPU ADPF, DMA-BUF, AHardwareBuffer */
    EMU_PLUGIN_CAT_INPUT_HID          = 1u << 4, /* evdev, AInputQueue, XInput map */
    EMU_PLUGIN_CAT_AUDIO_BACKEND      = 1u << 5  /* AAudio MMAP low-latency output */
} EmuPluginCategory;

typedef enum EmuStatus {
    EMU_OK = 0,
    EMU_ERR_INVALID_ARG      = -1,
    EMU_ERR_ABI_MISMATCH     = -2,
    EMU_ERR_NOT_SUPPORTED    = -3,
    EMU_ERR_OUT_OF_MEMORY    = -4,
    EMU_ERR_DRIVER_IOCTL     = -5,
    EMU_ERR_VULKAN_INIT      = -6,
    EMU_ERR_PLUGIN_NOT_FOUND = -7
} EmuStatus;

typedef enum EmuLogLevel {
    EMU_LOG_ERROR = 0,
    EMU_LOG_WARN  = 1,
    EMU_LOG_INFO  = 2,
    EMU_LOG_DEBUG = 3
} EmuLogLevel;

/* Opaque native handles passed across the C ABI boundary */
typedef struct AHardwareBuffer AHardwareBuffer;
typedef struct ANativeWindow ANativeWindow;

typedef struct EmuCpuTopologyInfo {
    uint32_t total_cores;
    uint32_t performance_core_mask; /* Big / Prime cores */
    uint32_t efficiency_core_mask;  /* Little cores */
    uint32_t os_page_size_bytes;    /* 4096 or 16384 on Android 15 */
} EmuCpuTopologyInfo;

typedef struct EmuGpuSurfaceDesc {
    ANativeWindow* native_window;
    uint32_t       width;
    uint32_t       height;
    uint32_t       prefer_mailbox_present;
    uint32_t       enable_validation;
    const char*    custom_icd_path; /* Optional Turnip / custom Vulkan ICD */
} EmuGpuSurfaceDesc;

typedef struct EmuHostServices {
    uint32_t struct_size;
    uint32_t api_version_major;
    uint32_t api_version_minor;

    void (*log_msg)(void* host_ctx, EmuLogLevel level, const char* tag, const char* msg);

    /* Hardware Memory & DMA-BUF / AHardwareBuffer Services */
    EmuStatus (*alloc_hw_buffer)(
        void* host_ctx,
        uint32_t width,
        uint32_t height,
        uint32_t format,
        uint64_t usage_flags,
        AHardwareBuffer** out_buffer
    );
    void (*release_hw_buffer)(void* host_ctx, AHardwareBuffer* buffer);

    /* CPU Affinity & Android 15 ADPF Performance Hints */
    EmuStatus (*query_cpu_topology)(void* host_ctx, EmuCpuTopologyInfo* out_info);
    EmuStatus (*pin_current_thread_mask)(void* host_ctx, uint32_t core_mask);
    EmuStatus (*report_adpf_work_duration)(void* host_ctx, int64_t actual_ns, int64_t target_ns);

    /* Cross-plugin capability discovery */
    void* (*query_interface)(void* host_ctx, const char* interface_id);

    void* host_ctx;
} EmuHostServices;

typedef struct EmuPluginVTable {
    uint32_t struct_size;
    EmuStatus (*init)(void* plugin_ctx, const EmuHostServices* host);
    void      (*shutdown)(void* plugin_ctx);
    EmuStatus (*on_configure)(void* plugin_ctx, const char* key, const char* value);
    void*     (*get_interface)(void* plugin_ctx, const char* interface_id);
} EmuPluginVTable;

typedef struct EmuPluginDescriptor {
    uint32_t           magic;
    uint32_t           struct_size;
    uint32_t           api_version_major;
    uint32_t           api_version_minor;
    const char*        plugin_id;        /* Reverse-DNS e.g. "org.emu.gpu.vulkan_turnip" */
    const char*        display_name;
    const char*        author;
    const char*        semver;
    uint32_t           category_flags;   /* Bitmask of EmuPluginCategory */
    uint32_t           priority;         /* Higher priority wins for same capability */
    const char* const* dependencies;     /* Null-terminated list of required plugin_id */
    void*              plugin_ctx;
    EmuPluginVTable    vtable;
} EmuPluginDescriptor;

/* Every modular .so plugin exports this exact C symbol */
typedef const EmuPluginDescriptor* (*EmuPluginEntryFn)(void);
#define EMU_PLUGIN_ENTRY_SYMBOL "emu_plugin_entry"

#ifdef __cplusplus
}
#endif

#endif /* EMU_PLUGIN_API_H */
