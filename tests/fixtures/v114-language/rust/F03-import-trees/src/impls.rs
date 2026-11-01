use crate::alpha::{Thing, Trait};
impl Thing<u8> {
    pub fn run(&self) {}
    pub const VALUE: u8 = 1;
}
impl Trait for Thing<u8> {
    fn run(&self) {}
    type Output = u8;
}
impl<T> Thing<T> where T: Copy { pub fn generic(&self) {} }
impl Thing<u16> { pub fn run(&self) {} }
impl Unknown { fn missing(&self) {} }
