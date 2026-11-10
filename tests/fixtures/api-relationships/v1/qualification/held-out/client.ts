declare const url: string
export function valid() { return fetch('/ok') }
export function duplicate() { return fetch('/dupe') }
export function wrongCase() { return fetch('/Case') }
export function wrongMethod() { return fetch('/ok', { method: 'POST' }) }
export function absent() { return fetch('/absent') }
export function dynamic() { return fetch(url) }
export function external() { return fetch('https://example.test/ok') }
