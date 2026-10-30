pub trait Runner { fn run(&self) -> u8; }
pub struct Worker;
impl Worker {
    pub fn run(&self) -> u8 { 1 }
}
impl Runner for Worker {
    fn run(&self) -> u8 { 2 }
}
pub mod nested;
