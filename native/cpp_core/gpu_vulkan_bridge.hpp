#pragma once

#define VK_USE_PLATFORM_ANDROID_KHR
#include <vulkan/vulkan.h>
#include <vulkan/vulkan_android.h>

#include "../include/emu_plugin_api.h"
#include <cstdint>
#include <string>
#include <vector>

namespace emu::gpu {

struct ImportedAhbTexture {
    VkImage image = VK_NULL_HANDLE;
    VkDeviceMemory memory = VK_NULL_HANDLE;
    VkImageView view = VK_NULL_HANDLE;
    uint32_t width = 0;
    uint32_t height = 0;
};

struct GpuDeviceCapabilities {
    std::string device_name;
    uint32_t api_version = 0;
    uint32_t driver_version = 0;
    uint32_t vendor_id = 0;
    bool supports_ahb_import = false;
    bool supports_timeline_semaphores = false;
    bool supports_display_timing = false;
    bool supports_dynamic_rendering = false;
};

class VulkanGpuBridge {
public:
    VulkanGpuBridge() = default;
    ~VulkanGpuBridge();

    VulkanGpuBridge(const VulkanGpuBridge&) = delete;
    VulkanGpuBridge& operator=(const VulkanGpuBridge&) = delete;

    EmuStatus initialize(const EmuGpuSurfaceDesc& desc, const char* pipeline_cache_path);
    void shutdown();

    // Zero-copy import of Android AHardwareBuffer directly into VkImage (for DXVK / Wine surface sharing)
    EmuStatus import_ahardware_buffer(
        AHardwareBuffer* ahb,
        uint32_t width,
        uint32_t height,
        ImportedAhbTexture& out_tex
    ) const;
    void destroy_imported_texture(ImportedAhbTexture& tex) const;

    // Frame submission with Timeline Semaphores + low-latency present
    EmuStatus submit_and_present(
        uint32_t image_index,
        VkCommandBuffer cmd,
        uint64_t signal_timeline_value
    );

    EmuStatus save_pipeline_cache(const char* cache_path) const;

    [[nodiscard]] const GpuDeviceCapabilities& capabilities() const { return caps_; }
    [[nodiscard]] VkDevice device() const { return device_; }
    [[nodiscard]] VkQueue graphics_queue() const { return graphics_queue_; }
    [[nodiscard]] VkSwapchainKHR swapchain() const { return swapchain_; }

private:
    EmuStatus load_icd_symbols(const char* custom_icd_path);
    EmuStatus create_swapchain(uint32_t width, uint32_t height, bool prefer_mailbox);
    void load_pipeline_cache(const char* cache_path);

    void* vulkan_lib_handle_ = nullptr;
    PFN_vkGetInstanceProcAddr vkGetInstanceProcAddr_ = nullptr;

    VkInstance instance_ = VK_NULL_HANDLE;
    VkPhysicalDevice physical_device_ = VK_NULL_HANDLE;
    VkDevice device_ = VK_NULL_HANDLE;
    VkQueue graphics_queue_ = VK_NULL_HANDLE;
    uint32_t graphics_queue_family_ = 0;

    VkSurfaceKHR surface_ = VK_NULL_HANDLE;
    VkSwapchainKHR swapchain_ = VK_NULL_HANDLE;
    VkFormat swapchain_format_ = VK_FORMAT_R8G8B8A8_UNORM;
    VkExtent2D swapchain_extent_{};
    std::vector<VkImage> swapchain_images_;

    VkSemaphore timeline_semaphore_ = VK_NULL_HANDLE;
    VkSemaphore acquire_semaphore_ = VK_NULL_HANDLE;
    VkSemaphore present_semaphore_ = VK_NULL_HANDLE;
    VkPipelineCache pipeline_cache_ = VK_NULL_HANDLE;

    GpuDeviceCapabilities caps_{};

    // Dynamically resolved Android AHB extension entry points
    PFN_vkGetAndroidHardwareBufferPropertiesANDROID pfn_get_ahb_props_ = nullptr;
    PFN_vkGetMemoryAndroidHardwareBufferANDROID pfn_get_mem_ahb_ = nullptr;
};

} // namespace emu::gpu
