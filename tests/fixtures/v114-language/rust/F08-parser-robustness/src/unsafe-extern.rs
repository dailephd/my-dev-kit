unsafe extern "C" {
    pub safe fn foreign_safe(value: u32) -> u32;
    pub unsafe fn foreign_unsafe(value: *const u8);
    pub static FOREIGN: u32;
}
pub extern "C" fn exported(value: u32) -> u32 { value }
