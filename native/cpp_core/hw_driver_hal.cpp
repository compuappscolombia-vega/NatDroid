#include "hw_driver_hal.hpp"

#include <android/hardware_buffer.h>
#include <android/performance_hint.h>
#include <dirent.h>
#include <fcntl.h>
#include <linux/dma-buf.h>
#include <pthread.h>
#include <sched.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <unistd.h>

#include <algorithm>
#include <cstring>
#include <fstream>

namespace emu::hal {

namespace {

int read_sysfs_int(const std::string& path, int fallback = -1) {
    std::ifstream ifs(path);
    if (!ifs.is_open()) {
        return fallback;
    }
    int val = fallback;
    ifs >> val;
    return ifs.fail() ? fallback : val;
}

int create_memfd_region(const char* name, size_t size) {
#ifdef __NR_memfd_create
    int fd = static_cast<int>(syscall(__NR_memfd_create, name, MFD_CLOEXEC));
#else
    int fd = memfd_create(name, MFD_CLOEXEC);
#endif
    if (fd < 0) {
        return -1;
    }
    if (ftruncate(fd, static_cast<off_t>(size)) != 0) {
        close(fd);
        return -1;
    }
    return fd;
}

} // namespace

HardwareDriverHal::HardwareDriverHal() = default;

HardwareDriverHal::~HardwareDriverHal() {
    shutdown();
}

EmuStatus HardwareDriverHal::initialize(APerformanceHintManager* hint_manager, int64_t target_frame_ns) {
    long page_sz = sysconf(_SC_PAGESIZE);
    topology_.os_page_size_bytes = page_sz > 0 ? static_cast<uint32_t>(page_sz) : 4096u;

    long online_cpus = sysconf(_SC_NPROCESSORS_CONF);
    uint32_t total = online_cpus > 0 ? static_cast<uint32_t>(std::min<long>(online_cpus, 32)) : 4u;
    topology_.total_cores = total;

    // Classify big/prime vs little cores via cpufreq cpuinfo_max_freq
    std::vector<int> max_freqs(total, 0);
    int global_max = 0;
    for (uint32_t i = 0; i < total; ++i) {
        std::string freq_path = "/sys/devices/system/cpu/cpu" + std::to_string(i) + "/cpufreq/cpuinfo_max_freq";
        max_freqs[i] = read_sysfs_int(freq_path, 0);
        global_max = std::max(global_max, max_freqs[i]);
    }

    uint32_t perf_mask = 0;
    uint32_t eff_mask = 0;
    const int threshold = static_cast<int>(global_max * 0.72);
    for (uint32_t i = 0; i < total; ++i) {
        if (global_max == 0 || max_freqs[i] >= threshold) {
            perf_mask |= (1u << i);
        } else {
            eff_mask |= (1u << i);
        }
    }
    topology_.performance_core_mask = perf_mask != 0 ? perf_mask : ((1u << total) - 1u);
    topology_.efficiency_core_mask = eff_mask;

    hint_manager_ = hint_manager;
    target_frame_ns_ = target_frame_ns > 0 ? target_frame_ns : 16666666;

    if (hint_manager_ != nullptr && hint_session_ == nullptr) {
        int32_t tid = static_cast<int32_t>(gettid());
        hint_session_ = APerformanceHint_createSession(hint_manager_, &tid, 1, target_frame_ns_);
    }

    return EMU_OK;
}

void HardwareDriverHal::shutdown() {
    if (hint_session_ != nullptr) {
        APerformanceHint_closeSession(hint_session_);
        hint_session_ = nullptr;
    }
    hint_manager_ = nullptr;
}

EmuCpuTopologyInfo HardwareDriverHal::query_cpu_topology() const {
    return topology_;
}

EmuStatus HardwareDriverHal::pin_current_thread(uint32_t core_mask) const {
    if (core_mask == 0) {
        return EMU_ERR_INVALID_ARG;
    }
    cpu_set_t cpuset;
    CPU_ZERO(&cpuset);
    for (uint32_t i = 0; i < 32; ++i) {
        if ((core_mask & (1u << i)) != 0) {
            CPU_SET(i, &cpuset);
        }
    }
    if (sched_setaffinity(0, sizeof(cpu_set_t), &cpuset) != 0) {
        return EMU_ERR_DRIVER_IOCTL;
    }
    return EMU_OK;
}

EmuStatus HardwareDriverHal::report_work_duration(int64_t actual_ns) const {
    if (hint_session_ == nullptr) {
        return EMU_ERR_NOT_SUPPORTED;
    }
    int rc = APerformanceHint_reportActualWorkDuration(hint_session_, actual_ns);
    return rc == 0 ? EMU_OK : EMU_ERR_DRIVER_IOCTL;
}

EmuStatus HardwareDriverHal::create_shared_memory(size_t bytes, const char* name, MemoryMapping& out_map) const {
    if (bytes == 0 || name == nullptr) {
        return EMU_ERR_INVALID_ARG;
    }
    const size_t pg = topology_.os_page_size_bytes;
    const size_t aligned_bytes = (bytes + pg - 1) & ~(pg - 1);

    int fd = create_memfd_region(name, aligned_bytes);
    if (fd < 0) {
        return EMU_ERR_OUT_OF_MEMORY;
    }

    void* ptr = mmap(nullptr, aligned_bytes, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (ptr == MAP_FAILED) {
        close(fd);
        return EMU_ERR_OUT_OF_MEMORY;
    }

    out_map.fd = fd;
    out_map.mapped_ptr = ptr;
    out_map.byte_size = aligned_bytes;
    out_map.page_size = pg;
    return EMU_OK;
}

void HardwareDriverHal::destroy_shared_memory(MemoryMapping& map) const {
    if (map.mapped_ptr != nullptr && map.mapped_ptr != MAP_FAILED) {
        munmap(map.mapped_ptr, map.byte_size);
    }
    if (map.fd >= 0) {
        close(map.fd);
    }
    map = MemoryMapping{};
}

EmuStatus HardwareDriverHal::allocate_hardware_buffer(
    uint32_t width,
    uint32_t height,
    uint32_t ahb_format,
    uint64_t usage_flags,
    AHardwareBuffer** out_buffer
) const {
    if (out_buffer == nullptr || width == 0 || height == 0) {
        return EMU_ERR_INVALID_ARG;
    }
    AHardwareBuffer_Desc desc{};
    desc.width = width;
    desc.height = height;
    desc.layers = 1;
    desc.format = ahb_format != 0 ? ahb_format : AHARDWAREBUFFER_FORMAT_R8G8B8A8_UNORM;
    desc.usage = usage_flags != 0
        ? usage_flags
        : (AHARDWAREBUFFER_USAGE_GPU_SAMPLED_IMAGE |
           AHARDWAREBUFFER_USAGE_GPU_COLOR_OUTPUT |
           AHARDWAREBUFFER_USAGE_CPU_WRITE_RARELY);

    int rc = AHardwareBuffer_allocate(&desc, out_buffer);
    return rc == 0 ? EMU_OK : EMU_ERR_OUT_OF_MEMORY;
}

void HardwareDriverHal::release_hardware_buffer(AHardwareBuffer* buffer) const {
    if (buffer != nullptr) {
        AHardwareBuffer_release(buffer);
    }
}

EmuStatus HardwareDriverHal::sync_dmabuf(int dmabuf_fd, bool start_sync, bool write_access) const {
    if (dmabuf_fd < 0) {
        return EMU_ERR_INVALID_ARG;
    }
    struct dma_buf_sync sync_args {};
    sync_args.flags = start_sync ? DMA_BUF_SYNC_START : DMA_BUF_SYNC_END;
    sync_args.flags |= write_access ? DMA_BUF_SYNC_RW : DMA_BUF_SYNC_READ;
    if (ioctl(dmabuf_fd, DMA_BUF_IOCTL_SYNC, &sync_args) != 0) {
        return EMU_ERR_DRIVER_IOCTL;
    }
    return EMU_OK;
}

std::vector<std::string> HardwareDriverHal::enumerate_evdev_nodes() const {
    std::vector<std::string> nodes;
    DIR* dir = opendir("/dev/input");
    if (!dir) {
        return nodes;
    }
    struct dirent* entry = nullptr;
    while ((entry = readdir(dir)) != nullptr) {
        if (std::strncmp(entry->d_name, "event", 5) == 0) {
            nodes.emplace_back(std::string("/dev/input/") + entry->d_name);
        }
    }
    closedir(dir);
    std::sort(nodes.begin(), nodes.end());
    return nodes;
}

} // namespace emu::hal
