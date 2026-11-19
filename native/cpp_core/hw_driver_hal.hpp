#pragma once

#include "../include/emu_plugin_api.h"
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

struct APerformanceHintManager;
struct APerformanceHintSession;

namespace emu::hal {

struct MemoryMapping {
    int fd = -1;
    void* mapped_ptr = nullptr;
    size_t byte_size = 0;
    size_t page_size = 4096;
};

class HardwareDriverHal {
public:
    HardwareDriverHal();
    ~HardwareDriverHal();

    HardwareDriverHal(const HardwareDriverHal&) = delete;
    HardwareDriverHal& operator=(const HardwareDriverHal&) = delete;

    EmuStatus initialize(APerformanceHintManager* hint_manager, int64_t target_frame_ns);
    void shutdown();

    // CPU & Android 15 ADPF Scheduler Integration
    [[nodiscard]] EmuCpuTopologyInfo query_cpu_topology() const;
    EmuStatus pin_current_thread(uint32_t core_mask) const;
    EmuStatus report_work_duration(int64_t actual_ns) const;

    // Shared Memory (memfd) & Zero-Copy AHardwareBuffer Allocation
    EmuStatus create_shared_memory(size_t bytes, const char* name, MemoryMapping& out_map) const;
    void destroy_shared_memory(MemoryMapping& map) const;

    EmuStatus allocate_hardware_buffer(
        uint32_t width,
        uint32_t height,
        uint32_t ahb_format,
        uint64_t usage_flags,
        AHardwareBuffer** out_buffer
    ) const;
    void release_hardware_buffer(AHardwareBuffer* buffer) const;

    // Direct DMA-BUF cache coherency sync for CPU/GPU shared regions
    EmuStatus sync_dmabuf(int dmabuf_fd, bool start_sync, bool write_access) const;

    // Low-latency Linux evdev input device discovery
    [[nodiscard]] std::vector<std::string> enumerate_evdev_nodes() const;

private:
    EmuCpuTopologyInfo topology_{};
    APerformanceHintManager* hint_manager_ = nullptr;
    APerformanceHintSession* hint_session_ = nullptr;
    int64_t target_frame_ns_ = 16666666; // 60Hz default, dynamically updated for 120Hz panels
};

} // namespace emu::hal
