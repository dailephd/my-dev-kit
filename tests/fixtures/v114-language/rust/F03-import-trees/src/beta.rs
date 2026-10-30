use super::alpha;
pub(super) use crate::alpha::Thing as ParentThing;
pub(in crate::beta) use crate::alpha::Trait as ScopedTrait;
pub mod inner { use super::super::alpha::nested as n; }
