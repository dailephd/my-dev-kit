pub trait Runner {
    type Output;
    const LIMIT: usize;
    fn run(&self);
    fn default_run(&self) { self.run(); }
}
pub struct Worker;
impl Worker {
    pub fn run(&self) { let nested = { 1 }; }
    pub const LIMIT: usize = 1;
    pub type Output = usize;
}
impl Runner for Worker {
    type Output = usize;
    const LIMIT: usize = 2;
    fn run(&self) {}
}
impl Worker { pub fn run(&self) {} }
mod inner { impl super::Worker { pub fn run(&self) {} } }
pub unsafe trait Trusted {}
unsafe impl Trusted for Worker {}
pub trait Alias = Runner;
