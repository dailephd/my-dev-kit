import defaultThing, { alpha as localAlpha, type Beta } from './sibling.js'
import * as helpers from '../helpers/util'
import 'side-effect-module'
import external from 'some-package'

export interface Shape { area(): number }
export type Id = string
export enum Color { Red, Green }
export class Circle implements Shape { area() { return 1 } }
export function make(): Circle { return new Circle() }
export const LIMIT = 10
let internalCounter = 0
const hidden = 1
function privateHelper() { return internalCounter + hidden }
export { privateHelper as exposedHelper }
export { remote as renamedRemote } from './remote.js'
export * from './barrel.js'
export default make
