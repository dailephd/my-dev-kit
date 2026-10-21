pub mod alpha;
pub mod beta;
mod impls;
pub mod dupe;
use crate::alpha::{Thing, Trait as LocalTrait};
use crate::alpha::nested::{self as nested_alias, helper};
use self::alpha as a;
pub use crate::alpha::Thing as PublicThing;
pub(crate) use crate::alpha::Trait as CrateTrait;
use crate::alpha::*;
use crate::missing::Absent;
use super::missing_parent;
use crate::dupe::Clash;
use std::collections::HashMap;
fn local() { use crate::alpha::nested; }
#[cfg(feature = "maybe")]
pub use crate::alpha::Thing as Conditional;
