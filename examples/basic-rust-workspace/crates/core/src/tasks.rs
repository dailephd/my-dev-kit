/// Something that can run one unit of work.
pub trait Runner {
    fn run(&self) -> u32;
}

/// A worker that doubles its identifier when run.
pub struct Worker {
    pub id: u32,
}

impl Worker {
    pub fn new(id: u32) -> Self {
        Worker { id }
    }
}

impl Runner for Worker {
    fn run(&self) -> u32 {
        self.id * 2
    }
}
