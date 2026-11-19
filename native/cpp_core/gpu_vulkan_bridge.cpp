#include "gpu_vulkan_bridge.hpp"

#include <android/hardware_buffer.h>
#include <dlfcn.h>
#include <cstdlib>
#include <cstring>
#include <fstream>

namespace emu::gpu {

namespace {

uint32_t find_memory_type(
    const VkPhysicalDeviceMemoryProperties& mem_props,
    uint32_t type_bits,
    VkMemoryPropertyFlags required_flags
) {
    for (uint32_t i = 0; i < mem_props.memoryTypeCount; ++i) {
        if ((type_bits & (1u << i)) &&
            (mem_props.memoryTypes[i].propertyFlags & required_flags) == required_flags) {
            return i;
        }
    }
    return UINT32_MAX;
}

} // namespace

VulkanGpuBridge::~VulkanGpuBridge() {
    shutdown();
}

EmuStatus VulkanGpuBridge::load_icd_symbols(const char* custom_icd_path) {
    // Allow loading custom Mesa Turnip / Adreno ICD if supplied via plugin config
    if (custom_icd_path != nullptr && custom_icd_path[0] != '\0') {
        setenv("VK_ICD_FILENAMES", custom_icd_path, 1);
    }

    vulkan_lib_handle_ = dlopen("libvulkan.so", RTLD_NOW | RTLD_LOCAL);
    if (!vulkan_lib_handle_) {
        return EMU_ERR_VULKAN_INIT;
    }

    vkGetInstanceProcAddr_ = reinterpret_cast<PFN_vkGetInstanceProcAddr>(
        dlsym(vulkan_lib_handle_, "vkGetInstanceProcAddr")
    );
    return vkGetInstanceProcAddr_ != nullptr ? EMU_OK : EMU_ERR_VULKAN_INIT;
}

EmuStatus VulkanGpuBridge::initialize(const EmuGpuSurfaceDesc& desc, const char* pipeline_cache_path) {
    if (desc.native_window == nullptr) {
        return EMU_ERR_INVALID_ARG;
    }
    if (load_icd_symbols(desc.custom_icd_path) != EMU_OK) {
        return EMU_ERR_VULKAN_INIT;
    }

    VkApplicationInfo app_info{};
    app_info.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
    app_info.pApplicationName = "Android15DesktopEmu";
    app_info.applicationVersion = VK_MAKE_VERSION(1, 0, 0);
    app_info.pEngineName = "EmuVulkanBridge";
    app_info.engineVersion = VK_MAKE_VERSION(1, 0, 0);
    app_info.apiVersion = VK_API_VERSION_1_3;

    const char* instance_exts[] = {
        VK_KHR_SURFACE_EXTENSION_NAME,
        VK_KHR_ANDROID_SURFACE_EXTENSION_NAME,
        VK_KHR_GET_PHYSICAL_DEVICE_PROPERTIES_2_EXTENSION_NAME,
        VK_KHR_EXTERNAL_MEMORY_CAPABILITIES_EXTENSION_NAME,
        VK_KHR_EXTERNAL_SEMAPHORE_CAPABILITIES_EXTENSION_NAME
    };

    VkInstanceCreateInfo inst_ci{};
    inst_ci.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
    inst_ci.pApplicationInfo = &app_info;
    inst_ci.enabledExtensionCount = static_cast<uint32_t>(sizeof(instance_exts) / sizeof(instance_exts[0]));
    inst_ci.ppEnabledExtensionNames = instance_exts;

    if (vkCreateInstance(&inst_ci, nullptr, &instance_) != VK_SUCCESS) {
        return EMU_ERR_VULKAN_INIT;
    }

    uint32_t gpu_count = 0;
    vkEnumeratePhysicalDevices(instance_, &gpu_count, nullptr);
    if (gpu_count == 0) {
        shutdown();
        return EMU_ERR_VULKAN_INIT;
    }

    std::vector<VkPhysicalDevice> gpus(gpu_count);
    vkEnumeratePhysicalDevices(instance_, &gpu_count, gpus.data());
    physical_device_ = gpus[0];

    VkPhysicalDeviceProperties props{};
    vkGetPhysicalDeviceProperties(physical_device_, &props);
    caps_.device_name = props.deviceName;
    caps_.api_version = props.apiVersion;
    caps_.driver_version = props.driverVersion;
    caps_.vendor_id = props.vendorID;

    uint32_t qf_count = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(physical_device_, &qf_count, nullptr);
    std::vector<VkQueueFamilyProperties> qf_props(qf_count);
    vkGetPhysicalDeviceQueueFamilyProperties(physical_device_, &qf_count, qf_props.data());

    graphics_queue_family_ = UINT32_MAX;
    for (uint32_t i = 0; i < qf_count; ++i) {
        if ((qf_props[i].queueFlags & VK_QUEUE_GRAPHICS_BIT) != 0) {
            graphics_queue_family_ = i;
            break;
        }
    }
    if (graphics_queue_family_ == UINT32_MAX) {
        shutdown();
        return EMU_ERR_VULKAN_INIT;
    }

    // Create Android Surface early to verify queue presentation support
    VkAndroidSurfaceCreateInfoKHR surf_ci{};
    surf_ci.sType = VK_STRUCTURE_TYPE_ANDROID_SURFACE_CREATE_INFO_KHR;
    surf_ci.window = desc.native_window;
    if (vkCreateAndroidSurfaceKHR(instance_, &surf_ci, nullptr, &surface_) != VK_SUCCESS) {
        shutdown();
        return EMU_ERR_VULKAN_INIT;
    }

    // Check supported device extensions
    uint32_t ext_count = 0;
    vkEnumerateDeviceExtensionProperties(physical_device_, nullptr, &ext_count, nullptr);
    std::vector<VkExtensionProperties> dev_exts(ext_count);
    vkEnumerateDeviceExtensionProperties(physical_device_, nullptr, &ext_count, dev_exts.data());

    auto has_ext = [&](const char* name) {
        for (const auto& e : dev_exts) {
            if (std::strcmp(e.extensionName, name) == 0) return true;
        }
        return false;
    };

    caps_.supports_ahb_import = has_ext(VK_ANDROID_EXTERNAL_MEMORY_ANDROID_HARDWARE_BUFFER_EXTENSION_NAME);
    caps_.supports_timeline_semaphores = has_ext(VK_KHR_TIMELINE_SEMAPHORE_EXTENSION_NAME) || (props.apiVersion >= VK_API_VERSION_1_2);
    caps_.supports_display_timing = has_ext(VK_GOOGLE_DISPLAY_TIMING_EXTENSION_NAME);
    caps_.supports_dynamic_rendering = has_ext(VK_KHR_DYNAMIC_RENDERING_EXTENSION_NAME) || (props.apiVersion >= VK_API_VERSION_1_3);

    std::vector<const char*> enabled_dev_exts = {
        VK_KHR_SWAPCHAIN_EXTENSION_NAME,
        VK_KHR_EXTERNAL_MEMORY_EXTENSION_NAME,
        VK_KHR_EXTERNAL_MEMORY_FD_EXTENSION_NAME
    };
    if (caps_.supports_ahb_import) {
        enabled_dev_exts.push_back(VK_ANDROID_EXTERNAL_MEMORY_ANDROID_HARDWARE_BUFFER_EXTENSION_NAME);
        enabled_dev_exts.push_back(VK_KHR_SAMPLER_YCBCR_CONVERSION_EXTENSION_NAME);
        enabled_dev_exts.push_back(VK_EXT_QUEUE_FAMILY_FOREIGN_EXTENSION_NAME);
    }
    if (caps_.supports_display_timing) {
        enabled_dev_exts.push_back(VK_GOOGLE_DISPLAY_TIMING_EXTENSION_NAME);
    }

    float queue_prio = 1.0f;
    VkDeviceQueueCreateInfo qci{};
    qci.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
    qci.queueFamilyIndex = graphics_queue_family_;
    qci.queueCount = 1;
    qci.pQueuePriorities = &queue_prio;

    VkPhysicalDeviceVulkan12Features vk12_feats{};
    vk12_feats.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_2_FEATURES;
    vk12_feats.timelineSemaphore = VK_TRUE;
    vk12_feats.descriptorIndexing = VK_TRUE;

    VkPhysicalDeviceVulkan13Features vk13_feats{};
    vk13_feats.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_3_FEATURES;
    vk13_feats.pNext = &vk12_feats;
    vk13_feats.dynamicRendering = caps_.supports_dynamic_rendering ? VK_TRUE : VK_FALSE;
    vk13_feats.synchronization2 = VK_TRUE;

    VkDeviceCreateInfo dev_ci{};
    dev_ci.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
    dev_ci.pNext = &vk13_feats;
    dev_ci.queueCreateInfoCount = 1;
    dev_ci.pQueueCreateInfos = &qci;
    dev_ci.enabledExtensionCount = static_cast<uint32_t>(enabled_dev_exts.size());
    dev_ci.ppEnabledExtensionNames = enabled_dev_exts.data();

    if (vkCreateDevice(physical_device_, &dev_ci, nullptr, &device_) != VK_SUCCESS) {
        shutdown();
        return EMU_ERR_VULKAN_INIT;
    }

    vkGetDeviceQueue(device_, graphics_queue_family_, 0, &graphics_queue_);

    if (caps_.supports_ahb_import) {
        pfn_get_ahb_props_ = reinterpret_cast<PFN_vkGetAndroidHardwareBufferPropertiesANDROID>(
            vkGetDeviceProcAddr(device_, "vkGetAndroidHardwareBufferPropertiesANDROID")
        );
        pfn_get_mem_ahb_ = reinterpret_cast<PFN_vkGetMemoryAndroidHardwareBufferANDROID>(
            vkGetDeviceProcAddr(device_, "vkGetMemoryAndroidHardwareBufferANDROID")
        );
    }

    // Create Timeline Semaphore + Binary Swapchain Semaphores
    VkSemaphoreTypeCreateInfo timeline_ci{};
    timeline_ci.sType = VK_STRUCTURE_TYPE_SEMAPHORE_TYPE_CREATE_INFO;
    timeline_ci.semaphoreType = VK_SEMAPHORE_TYPE_TIMELINE;
    timeline_ci.initialValue = 0;

    VkSemaphoreCreateInfo sem_ci{};
    sem_ci.sType = VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO;
    sem_ci.pNext = &timeline_ci;
    vkCreateSemaphore(device_, &sem_ci, nullptr, &timeline_semaphore_);

    sem_ci.pNext = nullptr;
    vkCreateSemaphore(device_, &sem_ci, nullptr, &acquire_semaphore_);
    vkCreateSemaphore(device_, &sem_ci, nullptr, &present_semaphore_);

    load_pipeline_cache(pipeline_cache_path);

    if (create_swapchain(desc.width, desc.height, desc.prefer_mailbox_present != 0) != EMU_OK) {
        shutdown();
        return EMU_ERR_VULKAN_INIT;
    }

    return EMU_OK;
}

EmuStatus VulkanGpuBridge::create_swapchain(uint32_t width, uint32_t height, bool prefer_mailbox) {
    VkSurfaceCapabilitiesKHR surf_caps{};
    vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physical_device_, surface_, &surf_caps);

    swapchain_extent_.width = surf_caps.currentExtent.width != UINT32_MAX ? surf_caps.currentExtent.width : width;
    swapchain_extent_.height = surf_caps.currentExtent.height != UINT32_MAX ? surf_caps.currentExtent.height : height;

    uint32_t pm_count = 0;
    vkGetPhysicalDeviceSurfacePresentModesKHR(physical_device_, surface_, &pm_count, nullptr);
    std::vector<VkPresentModeKHR> modes(pm_count);
    vkGetPhysicalDeviceSurfacePresentModesKHR(physical_device_, surface_, &pm_count, modes.data());

    VkPresentModeKHR chosen_mode = VK_PRESENT_MODE_FIFO_KHR;
    if (prefer_mailbox) {
        for (auto m : modes) {
            if (m == VK_PRESENT_MODE_MAILBOX_KHR) {
                chosen_mode = VK_PRESENT_MODE_MAILBOX_KHR;
                break;
            }
        }
    }

    uint32_t image_count = surf_caps.minImageCount + 1;
    if (surf_caps.maxImageCount > 0 && image_count > surf_caps.maxImageCount) {
        image_count = surf_caps.maxImageCount;
    }

    VkSwapchainCreateInfoKHR sc_ci{};
    sc_ci.sType = VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR;
    sc_ci.surface = surface_;
    sc_ci.minImageCount = image_count;
    sc_ci.imageFormat = swapchain_format_;
    sc_ci.imageColorSpace = VK_COLOR_SPACE_SRGB_NONLINEAR_KHR;
    sc_ci.imageExtent = swapchain_extent_;
    sc_ci.imageArrayLayers = 1;
    sc_ci.imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT;
    sc_ci.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
    sc_ci.preTransform = surf_caps.currentTransform;
    sc_ci.compositeAlpha = VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
    sc_ci.presentMode = chosen_mode;
    sc_ci.clipped = VK_TRUE;

    if (vkCreateSwapchainKHR(device_, &sc_ci, nullptr, &swapchain_) != VK_SUCCESS) {
        return EMU_ERR_VULKAN_INIT;
    }

    uint32_t sc_img_count = 0;
    vkGetSwapchainImagesKHR(device_, swapchain_, &sc_img_count, nullptr);
    swapchain_images_.resize(sc_img_count);
    vkGetSwapchainImagesKHR(device_, swapchain_, &sc_img_count, swapchain_images_.data());

    return EMU_OK;
}

EmuStatus VulkanGpuBridge::import_ahardware_buffer(
    AHardwareBuffer* ahb,
    uint32_t width,
    uint32_t height,
    ImportedAhbTexture& out_tex
) const {
    if (!caps_.supports_ahb_import || pfn_get_ahb_props_ == nullptr || ahb == nullptr) {
        return EMU_ERR_NOT_SUPPORTED;
    }

    VkAndroidHardwareBufferFormatPropertiesANDROID fmt_props{};
    fmt_props.sType = VK_STRUCTURE_TYPE_ANDROID_HARDWARE_BUFFER_FORMAT_PROPERTIES_ANDROID;

    VkAndroidHardwareBufferPropertiesANDROID ahb_props{};
    ahb_props.sType = VK_STRUCTURE_TYPE_ANDROID_HARDWARE_BUFFER_PROPERTIES_ANDROID;
    ahb_props.pNext = &fmt_props;

    if (pfn_get_ahb_props_(device_, ahb, &ahb_props) != VK_SUCCESS) {
        return EMU_ERR_VULKAN_INIT;
    }

    VkExternalMemoryImageCreateInfo ext_img_ci{};
    ext_img_ci.sType = VK_STRUCTURE_TYPE_EXTERNAL_MEMORY_IMAGE_CREATE_INFO;
    ext_img_ci.handleTypes = VK_EXTERNAL_MEMORY_HANDLE_TYPE_ANDROID_HARDWARE_BUFFER_BIT_ANDROID;

    VkImageCreateInfo img_ci{};
    img_ci.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
    img_ci.pNext = &ext_img_ci;
    img_ci.imageType = VK_IMAGE_TYPE_2D;
    img_ci.format = fmt_props.format != VK_FORMAT_UNDEFINED ? fmt_props.format : VK_FORMAT_R8G8B8A8_UNORM;
    img_ci.extent = {width, height, 1};
    img_ci.mipLevels = 1;
    img_ci.arrayLayers = 1;
    img_ci.samples = VK_SAMPLE_COUNT_1_BIT;
    img_ci.tiling = VK_IMAGE_TILING_OPTIMAL;
    img_ci.usage = VK_IMAGE_USAGE_SAMPLED_BIT | VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
    img_ci.sharingMode = VK_SHARING_MODE_EXCLUSIVE;

    if (vkCreateImage(device_, &img_ci, nullptr, &out_tex.image) != VK_SUCCESS) {
        return EMU_ERR_VULKAN_INIT;
    }

    VkPhysicalDeviceMemoryProperties mem_props{};
    vkGetPhysicalDeviceMemoryProperties(physical_device_, &mem_props);
    uint32_t mem_idx = find_memory_type(mem_props, ahb_props.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    if (mem_idx == UINT32_MAX) {
        mem_idx = find_memory_type(mem_props, ahb_props.memoryTypeBits, 0);
    }

    VkImportAndroidHardwareBufferInfoANDROID import_info{};
    import_info.sType = VK_STRUCTURE_TYPE_IMPORT_ANDROID_HARDWARE_BUFFER_INFO_ANDROID;
    import_info.buffer = ahb;

    VkMemoryDedicatedAllocateInfo ded_alloc{};
    ded_alloc.sType = VK_STRUCTURE_TYPE_MEMORY_DEDICATED_ALLOCATE_INFO;
    ded_alloc.pNext = &import_info;
    ded_alloc.image = out_tex.image;

    VkMemoryAllocateInfo alloc_info{};
    alloc_info.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    alloc_info.pNext = &ded_alloc;
    alloc_info.allocationSize = ahb_props.allocationSize;
    alloc_info.memoryTypeIndex = mem_idx;

    if (vkAllocateMemory(device_, &alloc_info, nullptr, &out_tex.memory) != VK_SUCCESS) {
        vkDestroyImage(device_, out_tex.image, nullptr);
        out_tex.image = VK_NULL_HANDLE;
        return EMU_ERR_OUT_OF_MEMORY;
    }

    vkBindImageMemory(device_, out_tex.image, out_tex.memory, 0);
    out_tex.width = width;
    out_tex.height = height;
    return EMU_OK;
}

void VulkanGpuBridge::destroy_imported_texture(ImportedAhbTexture& tex) const {
    if (device_ != VK_NULL_HANDLE) {
        if (tex.view != VK_NULL_HANDLE) vkDestroyImageView(device_, tex.view, nullptr);
        if (tex.image != VK_NULL_HANDLE) vkDestroyImage(device_, tex.image, nullptr);
        if (tex.memory != VK_NULL_HANDLE) vkFreeMemory(device_, tex.memory, nullptr);
    }
    tex = ImportedAhbTexture{};
}

EmuStatus VulkanGpuBridge::submit_and_present(
    uint32_t image_index,
    VkCommandBuffer cmd,
    uint64_t signal_timeline_value
) {
    VkSemaphore signal_sems[] = {present_semaphore_, timeline_semaphore_};
    uint64_t signal_vals[] = {0, signal_timeline_value};

    VkTimelineSemaphoreSubmitInfo timeline_submit{};
    timeline_submit.sType = VK_STRUCTURE_TYPE_TIMELINE_SEMAPHORE_SUBMIT_INFO;
    timeline_submit.signalSemaphoreValueCount = 2;
    timeline_submit.pSignalSemaphoreValues = signal_vals;

    VkPipelineStageFlags wait_stage = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    VkSubmitInfo submit{};
    submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    submit.pNext = &timeline_submit;
    submit.waitSemaphoreCount = 1;
    submit.pWaitSemaphores = &acquire_semaphore_;
    submit.pWaitDstStageMask = &wait_stage;
    submit.commandBufferCount = 1;
    submit.pCommandBuffers = &cmd;
    submit.signalSemaphoreCount = 2;
    submit.pSignalSemaphores = signal_sems;

    if (vkQueueSubmit(graphics_queue_, 1, &submit, VK_NULL_HANDLE) != VK_SUCCESS) {
        return EMU_ERR_VULKAN_INIT;
    }

    VkPresentInfoKHR present{};
    present.sType = VK_STRUCTURE_TYPE_PRESENT_INFO_KHR;
    present.waitSemaphoreCount = 1;
    present.pWaitSemaphores = &present_semaphore_;
    present.swapchainCount = 1;
    present.pSwapchains = &swapchain_;
    present.pImageIndices = &image_index;

    VkResult res = vkQueuePresentKHR(graphics_queue_, &present);
    return (res == VK_SUCCESS || res == VK_SUBOPTIMAL_KHR) ? EMU_OK : EMU_ERR_VULKAN_INIT;
}

void VulkanGpuBridge::load_pipeline_cache(const char* cache_path) {
    std::vector<uint8_t> cache_bytes;
    if (cache_path != nullptr && cache_path[0] != '\0') {
        std::ifstream ifs(cache_path, std::ios::binary | std::ios::ate);
        if (ifs.is_open()) {
            const auto sz = ifs.tellg();
            if (sz > 0) {
                cache_bytes.resize(static_cast<size_t>(sz));
                ifs.seekg(0);
                ifs.read(reinterpret_cast<char*>(cache_bytes.data()), sz);
            }
        }
    }
    VkPipelineCacheCreateInfo cache_ci{};
    cache_ci.sType = VK_STRUCTURE_TYPE_PIPELINE_CACHE_CREATE_INFO;
    cache_ci.initialDataSize = cache_bytes.size();
    cache_ci.pInitialData = cache_bytes.empty() ? nullptr : cache_bytes.data();
    vkCreatePipelineCache(device_, &cache_ci, nullptr, &pipeline_cache_);
}

EmuStatus VulkanGpuBridge::save_pipeline_cache(const char* cache_path) const {
    if (device_ == VK_NULL_HANDLE || pipeline_cache_ == VK_NULL_HANDLE || cache_path == nullptr) {
        return EMU_ERR_INVALID_ARG;
    }
    size_t sz = 0;
    vkGetPipelineCacheData(device_, pipeline_cache_, &sz, nullptr);
    if (sz == 0) {
        return EMU_OK;
    }
    std::vector<uint8_t> data(sz);
    vkGetPipelineCacheData(device_, pipeline_cache_, &sz, data.data());
    std::ofstream ofs(cache_path, std::ios::binary | std::ios::trunc);
    if (!ofs.is_open()) {
        return EMU_ERR_DRIVER_IOCTL;
    }
    ofs.write(reinterpret_cast<const char*>(data.data()), static_cast<std::streamsize>(sz));
    return EMU_OK;
}

void VulkanGpuBridge::shutdown() {
    if (device_ != VK_NULL_HANDLE) {
        vkDeviceWaitIdle(device_);
        if (pipeline_cache_ != VK_NULL_HANDLE) vkDestroyPipelineCache(device_, pipeline_cache_, nullptr);
        if (timeline_semaphore_ != VK_NULL_HANDLE) vkDestroySemaphore(device_, timeline_semaphore_, nullptr);
        if (acquire_semaphore_ != VK_NULL_HANDLE) vkDestroySemaphore(device_, acquire_semaphore_, nullptr);
        if (present_semaphore_ != VK_NULL_HANDLE) vkDestroySemaphore(device_, present_semaphore_, nullptr);
        if (swapchain_ != VK_NULL_HANDLE) vkDestroySwapchainKHR(device_, swapchain_, nullptr);
        vkDestroyDevice(device_, nullptr);
    }
    if (instance_ != VK_NULL_HANDLE) {
        if (surface_ != VK_NULL_HANDLE) vkDestroySurfaceKHR(instance_, surface_, nullptr);
        vkDestroyInstance(instance_, nullptr);
    }
    if (vulkan_lib_handle_ != nullptr) {
        dlclose(vulkan_lib_handle_);
    }

    pipeline_cache_ = VK_NULL_HANDLE;
    timeline_semaphore_ = VK_NULL_HANDLE;
    acquire_semaphore_ = VK_NULL_HANDLE;
    present_semaphore_ = VK_NULL_HANDLE;
    swapchain_ = VK_NULL_HANDLE;
    surface_ = VK_NULL_HANDLE;
    device_ = VK_NULL_HANDLE;
    instance_ = VK_NULL_HANDLE;
    vulkan_lib_handle_ = nullptr;
}

} // namespace emu::gpu
