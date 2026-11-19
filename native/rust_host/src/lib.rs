pub mod memory_hal;

use libc::{c_char, c_void};
use libloading::{Library, Symbol};
use std::collections::{HashMap, HashSet};
use std::ffi::{CStr, CString};
use std::path::Path;
use std::ptr;
use std::sync::{Arc, Mutex};

pub const EMU_PLUGIN_MAGIC: u32 = 0x454D_5535;
pub const EMU_PLUGIN_API_VERSION_MAJOR: u32 = 1;

#[repr(C)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum EmuStatus {
    Ok = 0,
    InvalidArg = -1,
    AbiMismatch = -2,
    NotSupported = -3,
    OutOfMemory = -4,
    DriverIoctl = -5,
    VulkanInit = -6,
    PluginNotFound = -7,
}

#[repr(C)]
pub struct EmuPluginVTable {
    pub struct_size: u32,
    pub init: Option<unsafe extern "C" fn(*mut c_void, *const c_void) -> EmuStatus>,
    pub shutdown: Option<unsafe extern "C" fn(*mut c_void)>,
    pub on_configure: Option<unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> EmuStatus>,
    pub get_interface: Option<unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void>,
}

#[repr(C)]
pub struct EmuPluginDescriptor {
    pub magic: u32,
    pub struct_size: u32,
    pub api_version_major: u32,
    pub api_version_minor: u32,
    pub plugin_id: *const c_char,
    pub display_name: *const c_char,
    pub author: *const c_char,
    pub semver: *const c_char,
    pub category_flags: u32,
    pub priority: u32,
    pub dependencies: *const *const c_char,
    pub plugin_ctx: *mut c_void,
    pub vtable: EmuPluginVTable,
}

type EntryFn = unsafe extern "C" fn() -> *const EmuPluginDescriptor;

pub struct LoadedPlugin {
    pub id: String,
    pub category_flags: u32,
    pub priority: u32,
    pub dependencies: Vec<String>,
    descriptor: *const EmuPluginDescriptor,
    _library: Library,
    initialized: bool,
}

// Safety: Plugin descriptors and Libraries are synchronized via Mutex<PluginRegistry>
unsafe impl Send for LoadedPlugin {}
unsafe impl Sync for LoadedPlugin {}

pub struct PluginRegistry {
    plugins: HashMap<String, LoadedPlugin>,
    init_order: Vec<String>,
    host_services_ptr: *const c_void,
}

unsafe impl Send for PluginRegistry {}
unsafe impl Sync for PluginRegistry {}

impl PluginRegistry {
    pub fn new(host_services_ptr: *const c_void) -> Self {
        Self {
            plugins: HashMap::new(),
            init_order: Vec::new(),
            host_services_ptr,
        }
    }

    pub fn load_shared_object(&mut self, so_path: &Path) -> Result<String, EmuStatus> {
        // Safety: dlopen on Android 15 isolated namespace / app lib dir
        let library = unsafe { Library::new(so_path) }.map_err(|_| EmuStatus::PluginNotFound)?;

        let entry_sym: Symbol<EntryFn> = unsafe { library.get(b"emu_plugin_entry\0") }
            .map_err(|_| EmuStatus::AbiMismatch)?;

        let desc_ptr = unsafe { entry_sym() };
        if desc_ptr.is_null() {
            return Err(EmuStatus::AbiMismatch);
        }

        let desc = unsafe { &*desc_ptr };
        if desc.magic != EMU_PLUGIN_MAGIC
            || desc.api_version_major != EMU_PLUGIN_API_VERSION_MAJOR
            || (desc.struct_size as usize) < std::mem::size_of::<EmuPluginDescriptor>()
            || (desc.vtable.struct_size as usize) < std::mem::size_of::<EmuPluginVTable>()
        {
            return Err(EmuStatus::AbiMismatch);
        }

        if desc.plugin_id.is_null() {
            return Err(EmuStatus::InvalidArg);
        }

        let id = unsafe { CStr::from_ptr(desc.plugin_id) }
            .to_string_lossy()
            .into_owned();

        let mut deps = Vec::new();
        if !desc.dependencies.is_null() {
            let mut cursor = desc.dependencies;
            unsafe {
                while !(*cursor).is_null() {
                    let dep_str = CStr::from_ptr(*cursor).to_string_lossy().into_owned();
                    deps.push(dep_str);
                    cursor = cursor.add(1);
                }
            }
        }

        let plugin = LoadedPlugin {
            id: id.clone(),
            category_flags: desc.category_flags,
            priority: desc.priority,
            dependencies: deps,
            descriptor: desc_ptr,
            _library: library,
            initialized: false,
        };

        self.plugins.insert(id.clone(), plugin);
        Ok(id)
    }

    pub fn initialize_all(&mut self) -> Result<(), EmuStatus> {
        let order = self.resolve_topological_order()?;
        for plugin_id in &order {
            if let Some(plugin) = self.plugins.get_mut(plugin_id) {
                if plugin.initialized {
                    continue;
                }
                let desc = unsafe { &*plugin.descriptor };
                if let Some(init_fn) = desc.vtable.init {
                    let status = unsafe { init_fn(desc.plugin_ctx, self.host_services_ptr) };
                    if status != EmuStatus::Ok {
                        return Err(status);
                    }
                }
                plugin.initialized = true;
            }
        }
        self.init_order = order;
        Ok(())
    }

    pub fn query_interface(&self, interface_id: &str) -> *mut c_void {
        let c_iface = match CString::new(interface_id) {
            Ok(s) => s,
            Err(_) => return ptr::null_mut(),
        };

        // Highest priority initialized plugin providing this interface wins
        let mut candidates: Vec<&LoadedPlugin> =
            self.plugins.values().filter(|p| p.initialized).collect();
        candidates.sort_by(|a, b| b.priority.cmp(&a.priority));

        for plugin in candidates {
            let desc = unsafe { &*plugin.descriptor };
            if let Some(get_iface) = desc.vtable.get_interface {
                let ptr_out = unsafe { get_iface(desc.plugin_ctx, c_iface.as_ptr()) };
                if !ptr_out.is_null() {
                    return ptr_out;
                }
            }
        }
        ptr::null_mut()
    }

    pub fn shutdown_all(&mut self) {
        for plugin_id in self.init_order.iter().rev() {
            if let Some(plugin) = self.plugins.get_mut(plugin_id) {
                if plugin.initialized {
                    let desc = unsafe { &*plugin.descriptor };
                    if let Some(shutdown_fn) = desc.vtable.shutdown {
                        unsafe { shutdown_fn(desc.plugin_ctx) };
                    }
                    plugin.initialized = false;
                }
            }
        }
        self.init_order.clear();
        self.plugins.clear();
    }

    fn resolve_topological_order(&self) -> Result<Vec<String>, EmuStatus> {
        let mut visited = HashSet::new();
        let mut visiting = HashSet::new();
        let mut order = Vec::new();

        let mut keys: Vec<String> = self.plugins.keys().cloned().collect();
        keys.sort();

        for id in keys {
            self.dfs_visit(&id, &mut visited, &mut visiting, &mut order)?;
        }
        Ok(order)
    }

    fn dfs_visit(
        &self,
        id: &str,
        visited: &mut HashSet<String>,
        visiting: &mut HashSet<String>,
        order: &mut Vec<String>,
    ) -> Result<(), EmuStatus> {
        if visited.contains(id) {
            return Ok(());
        }
        if !visiting.insert(id.to_string()) {
            return Err(EmuStatus::AbiMismatch); /* Dependency cycle */
        }

        let plugin = self.plugins.get(id).ok_or(EmuStatus::PluginNotFound)?;
        for dep in &plugin.dependencies {
            self.dfs_visit(dep, visited, visiting, order)?;
        }

        visiting.remove(id);
        visited.insert(id.to_string());
        order.push(id.to_string());
        Ok(())
    }
}

pub struct HostRegistryHandle {
    pub inner: Arc<Mutex<PluginRegistry>>,
}

#[no_mangle]
pub unsafe extern "C" fn emu_rust_registry_create(
    host_services_ptr: *const c_void,
) -> *mut HostRegistryHandle {
    let handle = Box::new(HostRegistryHandle {
        inner: Arc::new(Mutex::new(PluginRegistry::new(host_services_ptr))),
    });
    Box::into_raw(handle)
}

#[no_mangle]
pub unsafe extern "C" fn emu_rust_registry_load(
    handle: *mut HostRegistryHandle,
    so_path: *const c_char,
) -> EmuStatus {
    if handle.is_null() || so_path.is_null() {
        return EmuStatus::InvalidArg;
    }
    let path_str = CStr::from_ptr(so_path).to_string_lossy();
    let registry = &(*handle).inner;
    let mut guard = match registry.lock() {
        Ok(g) => g,
        Err(_) => return EmuStatus::InvalidArg,
    };
    match guard.load_shared_object(Path::new(path_str.as_ref())) {
        Ok(_) => EmuStatus::Ok,
        Err(e) => e,
    }
}

#[no_mangle]
pub unsafe extern "C" fn emu_rust_registry_init_all(handle: *mut HostRegistryHandle) -> EmuStatus {
    if handle.is_null() {
        return EmuStatus::InvalidArg;
    }
    let mut guard = match (*handle).inner.lock() {
        Ok(g) => g,
        Err(_) => return EmuStatus::InvalidArg,
    };
    match guard.initialize_all() {
        Ok(()) => EmuStatus::Ok,
        Err(e) => e,
    }
}

#[no_mangle]
pub unsafe extern "C" fn emu_rust_registry_query_interface(
    handle: *mut HostRegistryHandle,
    interface_id: *const c_char,
) -> *mut c_void {
    if handle.is_null() || interface_id.is_null() {
        return ptr::null_mut();
    }
    let iface = CStr::from_ptr(interface_id).to_string_lossy();
    let guard = match (*handle).inner.lock() {
        Ok(g) => g,
        Err(_) => return ptr::null_mut(),
    };
    guard.query_interface(iface.as_ref())
}

#[no_mangle]
pub unsafe extern "C" fn emu_rust_registry_destroy(handle: *mut HostRegistryHandle) {
    if handle.is_null() {
        return;
    }
    let boxed = Box::from_raw(handle);
    if let Ok(mut guard) = boxed.inner.lock() {
        guard.shutdown_all();
    }
}
