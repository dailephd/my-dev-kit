pub fn greet(name: &str) -> String { format!("hello {name}") }
pub async fn fetch<T: Clone>(value: T) -> T where T: Send { value }
pub const fn answer() -> u32 { 42 }
pub unsafe fn pointer(value: *const u8) -> u8 { unsafe { *value } }
pub struct Named { pub value: u32 }
pub struct Tuple(pub u32, pub bool);
pub struct Unit;
pub enum Choice { Named { value: u32 }, Tuple(u32), Unit }
pub union Bits { pub integer: u32, pub floating: f32 }
pub type Number = u32;
pub const LIMIT: u32 = 42;
pub static READY: bool = true;
mod external;
pub mod nested { pub fn inside() {} }
pub use crate::{nested::inside as local_inside, Choice::*};
use super::external;
