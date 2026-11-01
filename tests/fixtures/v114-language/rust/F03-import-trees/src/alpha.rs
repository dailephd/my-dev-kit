pub mod nested;
pub struct Thing<T> { pub value: T }
pub trait Trait { fn run(&self); }
pub enum Choice { One }
pub union Bits { pub word: u32 }
pub type Alias = Thing<u8>;
struct Private;
