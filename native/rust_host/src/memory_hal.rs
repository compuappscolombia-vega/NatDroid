use libc::{c_void, mmap, munmap, sysconf, MAP_ANONYMOUS, MAP_FAILED, MAP_PRIVATE, PROT_NONE, PROT_READ, PROT_WRITE, _SC_PAGESIZE};
use std::cell::UnsafeCell;
use std::mem::MaybeUninit;
use std::ptr;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Cache-line padded lock-free SPSC ring buffer for zero-latency HID/evdev input events
/// between Android UI/Input threads and the native desktop application thread.
#[repr(C, align(64))]
pub struct SpscInputRing<T: Copy, const N: usize> {
    head: AtomicUsize,
    _pad1: [u8; 64 - std::mem::size_of::<AtomicUsize>()],
    tail: AtomicUsize,
    _pad2: [u8; 64 - std::mem::size_of::<AtomicUsize>()],
    slots: [UnsafeCell<MaybeUninit<T>>; N],
}

unsafe impl<T: Copy + Send, const N: usize> Sync for SpscInputRing<T, N> {}
unsafe impl<T: Copy + Send, const N: usize> Send for SpscInputRing<T, N> {}

#[repr(C)]
#[derive(Copy, Clone, Debug)]
pub struct EmuRawInputPacket {
    pub timestamp_ns: u64,
    pub device_id: u32,
    pub event_type: u16, /* 1 = Key, 2 = RelMouse, 3 = AbsTouch, 4 = GamepadAxis */
    pub code: u16,
    pub value: i32,
}

impl<T: Copy, const N: usize> SpscInputRing<T, N> {
    pub const fn new() -> Self {
        assert!(N.is_power_of_two(), "Ring capacity must be power of two");
        Self {
            head: AtomicUsize::new(0),
            _pad1: [0; 64 - std::mem::size_of::<AtomicUsize>()],
            tail: AtomicUsize::new(0),
            _pad2: [0; 64 - std::mem::size_of::<AtomicUsize>()],
            slots: [const { UnsafeCell::new(MaybeUninit::uninit()) }; N],
        }
    }

    #[inline]
    pub fn try_push(&self, item: T) -> bool {
        let head = self.head.load(Ordering::Relaxed);
        let next_head = (head + 1) & (N - 1);
        if next_head == self.tail.load(Ordering::Acquire) {
            return false;
        }
        unsafe {
            (*self.slots[head].get()).write(item);
        }
        self.head.store(next_head, Ordering::Release);
        true
    }

    #[inline]
    pub fn try_pop(&self) -> Option<T> {
        let tail = self.tail.load(Ordering::Relaxed);
        if tail == self.head.load(Ordering::Acquire) {
            return None;
        }
        let item = unsafe { (*self.slots[tail].get()).assume_init_read() };
        self.tail.store((tail + 1) & (N - 1), Ordering::Release);
        Some(item)
    }
}

/// Reserves page-aligned guest address space compatible with Android 15 4KB & 16KB page sizes.
pub struct GuestAddressSpace {
    base: *mut c_void,
    size: usize,
    page_size: usize,
}

impl GuestAddressSpace {
    pub fn reserve(requested_bytes: usize) -> Option<Self> {
        let page_size = unsafe { sysconf(_SC_PAGESIZE) } as usize;
        if page_size == 0 {
            return None;
        }
        let aligned = (requested_bytes + page_size - 1) & !(page_size - 1);
        let ptr = unsafe {
            mmap(
                ptr::null_mut(),
                aligned,
                PROT_NONE,
                MAP_PRIVATE | MAP_ANONYMOUS,
                -1,
                0,
            )
        };
        if ptr == MAP_FAILED {
            return None;
        }
        Some(Self {
            base: ptr,
            size: aligned,
            page_size,
        })
    }

    pub fn commit_rw(&self, offset: usize, len: usize) -> bool {
        if offset % self.page_size != 0 || offset.saturating_add(len) > self.size {
            return false;
        }
        let target = unsafe { (self.base as *mut u8).add(offset) as *mut c_void };
        unsafe { libc::mprotect(target, len, PROT_READ | PROT_WRITE) == 0 }
    }

    pub fn base_ptr(&self) -> *mut c_void {
        self.base
    }

    pub fn page_size(&self) -> usize {
        self.page_size
    }
}

impl Drop for GuestAddressSpace {
    fn drop(&mut self) {
        if !self.base.is_null() {
            unsafe {
                munmap(self.base, self.size);
            }
        }
    }
}

static GLOBAL_INPUT_RING: SpscInputRing<EmuRawInputPacket, 4096> = SpscInputRing::new();

#[no_mangle]
pub extern "C" fn emu_input_ring_push(pkt: EmuRawInputPacket) -> bool {
    GLOBAL_INPUT_RING.try_push(pkt)
}

#[no_mangle]
pub extern "C" fn emu_input_ring_pop(out_pkt: *mut EmuRawInputPacket) -> bool {
    if out_pkt.is_null() {
        return false;
    }
    match GLOBAL_INPUT_RING.try_pop() {
        Some(pkt) => {
            unsafe { *out_pkt = pkt };
            true
        }
        None => false,
    }
}
