use basic_rust_core::{Runner, Worker};

fn main() {
    let worker = Worker::new(21);
    println!("{}", worker.run());
}
