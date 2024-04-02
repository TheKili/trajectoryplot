'use strict';

/** @returns {void} */
function noop() {}

const identity$4 = (x) => x;

/**
 * @template T
 * @template S
 * @param {T} tar
 * @param {S} src
 * @returns {T & S}
 */
function assign(tar, src) {
	// @ts-ignore
	for (const k in src) tar[k] = src[k];
	return /** @type {T & S} */ (tar);
}

function run(fn) {
	return fn();
}

function blank_object() {
	return Object.create(null);
}

/**
 * @param {Function[]} fns
 * @returns {void}
 */
function run_all(fns) {
	fns.forEach(run);
}

/**
 * @param {any} thing
 * @returns {thing is Function}
 */
function is_function(thing) {
	return typeof thing === 'function';
}

/** @returns {boolean} */
function safe_not_equal(a, b) {
	return a != a ? b == b : a !== b || (a && typeof a === 'object') || typeof a === 'function';
}

function subscribe(store, ...callbacks) {
	if (store == null) {
		for (const callback of callbacks) {
			callback(undefined);
		}
		return noop;
	}
	const unsub = store.subscribe(...callbacks);
	return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
}

function set_store_value(store, ret, value) {
	store.set(value);
	return ret;
}

const is_client = typeof window !== 'undefined';

/** @type {() => number} */
let now = is_client ? () => window.performance.now() : () => Date.now();

let raf = is_client ? (cb) => requestAnimationFrame(cb) : noop;

const tasks = new Set();

/**
 * @param {number} now
 * @returns {void}
 */
function run_tasks(now) {
	tasks.forEach((task) => {
		if (!task.c(now)) {
			tasks.delete(task);
			task.f();
		}
	});
	if (tasks.size !== 0) raf(run_tasks);
}

/**
 * Creates a new task that runs on each raf frame
 * until it returns a falsy value or is aborted
 * @param {import('./private.js').TaskCallback} callback
 * @returns {import('./private.js').Task}
 */
function loop(callback) {
	/** @type {import('./private.js').TaskEntry} */
	let task;
	if (tasks.size === 0) raf(run_tasks);
	return {
		promise: new Promise((fulfill) => {
			tasks.add((task = { c: callback, f: fulfill }));
		}),
		abort() {
			tasks.delete(task);
		}
	};
}

let current_component;

/** @returns {void} */
function set_current_component(component) {
	current_component = component;
}

function get_current_component() {
	if (!current_component) throw new Error('Function called outside component initialization');
	return current_component;
}

/**
 * Associates an arbitrary `context` object with the current component and the specified `key`
 * and returns that object. The context is then available to children of the component
 * (including slotted content) with `getContext`.
 *
 * Like lifecycle functions, this must be called during component initialisation.
 *
 * https://svelte.dev/docs/svelte#setcontext
 * @template T
 * @param {any} key
 * @param {T} context
 * @returns {T}
 */
function setContext(key, context) {
	get_current_component().$$.context.set(key, context);
	return context;
}

/**
 * Retrieves the context that belongs to the closest parent component with the specified `key`.
 * Must be called during component initialisation.
 *
 * https://svelte.dev/docs/svelte#getcontext
 * @template T
 * @param {any} key
 * @returns {T}
 */
function getContext(key) {
	return get_current_component().$$.context.get(key);
}

// general each functions:

function ensure_array_like(array_like_or_iterator) {
	return array_like_or_iterator?.length !== undefined
		? array_like_or_iterator
		: Array.from(array_like_or_iterator);
}

/** @returns {{}} */
function merge_ssr_styles(style_attribute, style_directive) {
	const style_object = {};
	for (const individual_style of style_attribute.split(';')) {
		const colon_index = individual_style.indexOf(':');
		const name = individual_style.slice(0, colon_index).trim();
		const value = individual_style.slice(colon_index + 1).trim();
		if (!name) continue;
		style_object[name] = value;
	}
	for (const name in style_directive) {
		const value = style_directive[name];
		if (value) {
			style_object[name] = value;
		} else {
			delete style_object[name];
		}
	}
	return style_object;
}

const ATTR_REGEX = /[&"]/g;
const CONTENT_REGEX = /[&<]/g;

/**
 * Note: this method is performance sensitive and has been optimized
 * https://github.com/sveltejs/svelte/pull/5701
 * @param {unknown} value
 * @returns {string}
 */
function escape(value, is_attr = false) {
	const str = String(value);
	const pattern = is_attr ? ATTR_REGEX : CONTENT_REGEX;
	pattern.lastIndex = 0;
	let escaped = '';
	let last = 0;
	while (pattern.test(str)) {
		const i = pattern.lastIndex - 1;
		const ch = str[i];
		escaped += str.substring(last, i) + (ch === '&' ? '&amp;' : ch === '"' ? '&quot;' : '&lt;');
		last = i + 1;
	}
	return escaped + str.substring(last);
}

function escape_attribute_value(value) {
	// keep booleans, null, and undefined for the sake of `spread`
	const should_escape = typeof value === 'string' || (value && typeof value === 'object');
	return should_escape ? escape(value, true) : value;
}

/** @returns {string} */
function each(items, fn) {
	items = ensure_array_like(items);
	let str = '';
	for (let i = 0; i < items.length; i += 1) {
		str += fn(items[i], i);
	}
	return str;
}

function validate_component(component, name) {
	if (!component || !component.$$render) {
		if (name === 'svelte:component') name += ' this={...}';
		throw new Error(
			`<${name}> is not a valid SSR component. You may need to review your build config to ensure that dependencies are compiled, rather than imported as pre-compiled modules. Otherwise you may need to fix a <${name}>.`
		);
	}
	return component;
}

let on_destroy;

/** @returns {{ render: (props?: {}, { $$slots, context }?: { $$slots?: {}; context?: Map<any, any>; }) => { html: any; css: { code: string; map: any; }; head: string; }; $$render: (result: any, props: any, bindings: any, slots: any, context: any) => any; }} */
function create_ssr_component(fn) {
	function $$render(result, props, bindings, slots, context) {
		const parent_component = current_component;
		const $$ = {
			on_destroy,
			context: new Map(context || (parent_component ? parent_component.$$.context : [])),
			// these will be immediately discarded
			on_mount: [],
			before_update: [],
			after_update: [],
			callbacks: blank_object()
		};
		set_current_component({ $$ });
		const html = fn(result, props, bindings, slots);
		set_current_component(parent_component);
		return html;
	}
	return {
		render: (props = {}, { $$slots = {}, context = new Map() } = {}) => {
			on_destroy = [];
			const result = { title: '', head: '', css: new Set() };
			const html = $$render(result, props, {}, $$slots, context);
			run_all(on_destroy);
			return {
				html,
				css: {
					code: Array.from(result.css)
						.map((css) => css.code)
						.join('\n'),
					map: null // TODO
				},
				head: result.title + result.head
			};
		},
		$$render
	};
}

/** @returns {string} */
function add_attribute(name, value, boolean) {
	if (value == null || (boolean && !value)) return '';
	const assignment = boolean && value === true ? '' : `="${escape(value, true)}"`;
	return ` ${name}${assignment}`;
}

/** @returns {string} */
function style_object_to_string(style_object) {
	return Object.keys(style_object)
		.filter((key) => style_object[key])
		.map((key) => `${key}: ${escape_attribute_value(style_object[key])};`)
		.join(' ');
}

/** @returns {string} */
function add_styles(style_object) {
	const styles = style_object_to_string(style_object);
	return styles ? ` style="${styles}"` : '';
}

const subscriber_queue = [];

/**
 * Creates a `Readable` store that allows reading by subscription.
 *
 * https://svelte.dev/docs/svelte-store#readable
 * @template T
 * @param {T} [value] initial value
 * @param {import('./public.js').StartStopNotifier<T>} [start]
 * @returns {import('./public.js').Readable<T>}
 */
function readable(value, start) {
	return {
		subscribe: writable(value, start).subscribe
	};
}

/**
 * Create a `Writable` store that allows both updating and reading by subscription.
 *
 * https://svelte.dev/docs/svelte-store#writable
 * @template T
 * @param {T} [value] initial value
 * @param {import('./public.js').StartStopNotifier<T>} [start]
 * @returns {import('./public.js').Writable<T>}
 */
function writable(value, start = noop) {
	/** @type {import('./public.js').Unsubscriber} */
	let stop;
	/** @type {Set<import('./private.js').SubscribeInvalidateTuple<T>>} */
	const subscribers = new Set();
	/** @param {T} new_value
	 * @returns {void}
	 */
	function set(new_value) {
		if (safe_not_equal(value, new_value)) {
			value = new_value;
			if (stop) {
				// store is ready
				const run_queue = !subscriber_queue.length;
				for (const subscriber of subscribers) {
					subscriber[1]();
					subscriber_queue.push(subscriber, value);
				}
				if (run_queue) {
					for (let i = 0; i < subscriber_queue.length; i += 2) {
						subscriber_queue[i][0](subscriber_queue[i + 1]);
					}
					subscriber_queue.length = 0;
				}
			}
		}
	}

	/**
	 * @param {import('./public.js').Updater<T>} fn
	 * @returns {void}
	 */
	function update(fn) {
		set(fn(value));
	}

	/**
	 * @param {import('./public.js').Subscriber<T>} run
	 * @param {import('./private.js').Invalidator<T>} [invalidate]
	 * @returns {import('./public.js').Unsubscriber}
	 */
	function subscribe(run, invalidate = noop) {
		/** @type {import('./private.js').SubscribeInvalidateTuple<T>} */
		const subscriber = [run, invalidate];
		subscribers.add(subscriber);
		if (subscribers.size === 1) {
			stop = start(set, update) || noop;
		}
		run(value);
		return () => {
			subscribers.delete(subscriber);
			if (subscribers.size === 0 && stop) {
				stop();
				stop = null;
			}
		};
	}
	return { set, update, subscribe };
}

/**
 * Derived value store by synchronizing one or more readable stores and
 * applying an aggregation function over its input values.
 *
 * https://svelte.dev/docs/svelte-store#derived
 * @template {import('./private.js').Stores} S
 * @template T
 * @overload
 * @param {S} stores - input stores
 * @param {(values: import('./private.js').StoresValues<S>, set: (value: T) => void, update: (fn: import('./public.js').Updater<T>) => void) => import('./public.js').Unsubscriber | void} fn - function callback that aggregates the values
 * @param {T} [initial_value] - initial value
 * @returns {import('./public.js').Readable<T>}
 */

/**
 * Derived value store by synchronizing one or more readable stores and
 * applying an aggregation function over its input values.
 *
 * https://svelte.dev/docs/svelte-store#derived
 * @template {import('./private.js').Stores} S
 * @template T
 * @overload
 * @param {S} stores - input stores
 * @param {(values: import('./private.js').StoresValues<S>) => T} fn - function callback that aggregates the values
 * @param {T} [initial_value] - initial value
 * @returns {import('./public.js').Readable<T>}
 */

/**
 * @template {import('./private.js').Stores} S
 * @template T
 * @param {S} stores
 * @param {Function} fn
 * @param {T} [initial_value]
 * @returns {import('./public.js').Readable<T>}
 */
function derived(stores, fn, initial_value) {
	const single = !Array.isArray(stores);
	/** @type {Array<import('./public.js').Readable<any>>} */
	const stores_array = single ? [stores] : stores;
	if (!stores_array.every(Boolean)) {
		throw new Error('derived() expects stores as input, got a falsy value');
	}
	const auto = fn.length < 2;
	return readable(initial_value, (set, update) => {
		let started = false;
		const values = [];
		let pending = 0;
		let cleanup = noop;
		const sync = () => {
			if (pending) {
				return;
			}
			cleanup();
			const result = fn(single ? values[0] : values, set, update);
			if (auto) {
				set(result);
			} else {
				cleanup = is_function(result) ? result : noop;
			}
		};
		const unsubscribers = stores_array.map((store, i) =>
			subscribe(
				store,
				(value) => {
					values[i] = value;
					pending &= ~(1 << i);
					if (started) {
						sync();
					}
				},
				() => {
					pending |= 1 << i;
				}
			)
		);
		started = true;
		sync();
		return function stop() {
			run_all(unsubscribers);
			cleanup();
			// We need to set this to false because callbacks can still happen despite having unsubscribed:
			// Callbacks might already be placed in the queue which doesn't know it should no longer
			// invoke this derived store.
			started = false;
		};
	});
}

/**
	A function to help truth test values. Returns a `true` if zero.
	@param {any} val The value to test.
	@returns {any}
*/
function canBeZero (val) {
	if (val === 0) {
		return true;
	}
	return val;
}

/**
	Make an accessor from a string, number, function or an array of the combination of any
	@param {String|Number|Function|Array} acc The accessor function, key or list of them.
	@returns {Function} An accessor function.
*/
function makeAccessor (acc) {
	if (!canBeZero(acc)) return null;
	if (Array.isArray(acc)) {
		return d => acc.map(k => {
			return typeof k !== 'function' ? d[k] : k(d);
		});
	} else if (typeof acc !== 'function') { // eslint-disable-line no-else-return
		return d => d[acc];
	}
	return acc;
}

// From Object.fromEntries polyfill https://github.com/tc39/proposal-object-from-entries/blob/master/polyfill.js#L1
function fromEntries(iter) {
	const obj = {};

	for (const pair of iter) {
		if (Object(pair) !== pair) {
			throw new TypeError("iterable for fromEntries should yield objects");
		}
		// Consistency with Map: contract is that entry has "0" and "1" keys, not
		// that it is an array or iterable.
		const { "0": key, "1": val } = pair;

		Object.defineProperty(obj, key, {
			configurable: true,
			enumerable: true,
			writable: true,
			value: val,
		});
	}

	return obj;
}

/**
	Remove undefined fields from an object
	@param {object} obj The object to filter
	@param {object} [comparisonObj={}] An object that, for any key, if the key is not present on that object, the key will be filtered out. Note, this ignores the value on that object
	@returns {object}
*/
function filterObject (obj, comparisonObj = {}) {
	return fromEntries(Object.entries(obj).filter(([key, value]) => {
		return value !== undefined
			&& comparisonObj[key] === undefined;
	}));
}

/**
	A simple debounce function taken from here https://www.freecodecamp.org/news/javascript-debounce-example/
	@param {function} func The function to debounce.
	@param {number} timeout The time in ms to wait.
	@returns {function}
*/
function debounce(func, timeout = 300) {
	let timer;
	return (...args) => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			func.apply(this, args);
		}, timeout);
	};
}

function ascending(a, b) {
  return a == null || b == null ? NaN : a < b ? -1 : a > b ? 1 : a >= b ? 0 : NaN;
}

function descending(a, b) {
  return a == null || b == null ? NaN
    : b < a ? -1
    : b > a ? 1
    : b >= a ? 0
    : NaN;
}

function bisector(f) {
  let compare1, compare2, delta;

  // If an accessor is specified, promote it to a comparator. In this case we
  // can test whether the search value is (self-) comparable. We can’t do this
  // for a comparator (except for specific, known comparators) because we can’t
  // tell if the comparator is symmetric, and an asymmetric comparator can’t be
  // used to test whether a single value is comparable.
  if (f.length !== 2) {
    compare1 = ascending;
    compare2 = (d, x) => ascending(f(d), x);
    delta = (d, x) => f(d) - x;
  } else {
    compare1 = f === ascending || f === descending ? f : zero$1;
    compare2 = f;
    delta = f;
  }

  function left(a, x, lo = 0, hi = a.length) {
    if (lo < hi) {
      if (compare1(x, x) !== 0) return hi;
      do {
        const mid = (lo + hi) >>> 1;
        if (compare2(a[mid], x) < 0) lo = mid + 1;
        else hi = mid;
      } while (lo < hi);
    }
    return lo;
  }

  function right(a, x, lo = 0, hi = a.length) {
    if (lo < hi) {
      if (compare1(x, x) !== 0) return hi;
      do {
        const mid = (lo + hi) >>> 1;
        if (compare2(a[mid], x) <= 0) lo = mid + 1;
        else hi = mid;
      } while (lo < hi);
    }
    return lo;
  }

  function center(a, x, lo = 0, hi = a.length) {
    const i = left(a, x, lo, hi - 1);
    return i > lo && delta(a[i - 1], x) > -delta(a[i], x) ? i - 1 : i;
  }

  return {left, center, right};
}

function zero$1() {
  return 0;
}

function number$1(x) {
  return x === null ? NaN : +x;
}

const ascendingBisect = bisector(ascending);
const bisectRight = ascendingBisect.right;
bisector(number$1).center;
var bisect = bisectRight;

class InternMap extends Map {
  constructor(entries, key = keyof) {
    super();
    Object.defineProperties(this, {_intern: {value: new Map()}, _key: {value: key}});
    if (entries != null) for (const [key, value] of entries) this.set(key, value);
  }
  get(key) {
    return super.get(intern_get(this, key));
  }
  has(key) {
    return super.has(intern_get(this, key));
  }
  set(key, value) {
    return super.set(intern_set(this, key), value);
  }
  delete(key) {
    return super.delete(intern_delete(this, key));
  }
}

class InternSet extends Set {
  constructor(values, key = keyof) {
    super();
    Object.defineProperties(this, {_intern: {value: new Map()}, _key: {value: key}});
    if (values != null) for (const value of values) this.add(value);
  }
  has(value) {
    return super.has(intern_get(this, value));
  }
  add(value) {
    return super.add(intern_set(this, value));
  }
  delete(value) {
    return super.delete(intern_delete(this, value));
  }
}

function intern_get({_intern, _key}, value) {
  const key = _key(value);
  return _intern.has(key) ? _intern.get(key) : value;
}

function intern_set({_intern, _key}, value) {
  const key = _key(value);
  if (_intern.has(key)) return _intern.get(key);
  _intern.set(key, value);
  return value;
}

function intern_delete({_intern, _key}, value) {
  const key = _key(value);
  if (_intern.has(key)) {
    value = _intern.get(key);
    _intern.delete(key);
  }
  return value;
}

function keyof(value) {
  return value !== null && typeof value === "object" ? value.valueOf() : value;
}

function identity$3(x) {
  return x;
}

function rollup(values, reduce, ...keys) {
  return nest(values, identity$3, reduce, keys);
}

function nest(values, map, reduce, keys) {
  return (function regroup(values, i) {
    if (i >= keys.length) return reduce(values);
    const groups = new InternMap();
    const keyof = keys[i++];
    let index = -1;
    for (const value of values) {
      const key = keyof(value, ++index, values);
      const group = groups.get(key);
      if (group) group.push(value);
      else groups.set(key, [value]);
    }
    for (const [key, values] of groups) {
      groups.set(key, regroup(values, i));
    }
    return map(groups);
  })(values, 0);
}

const e10 = Math.sqrt(50),
    e5 = Math.sqrt(10),
    e2 = Math.sqrt(2);

function tickSpec(start, stop, count) {
  const step = (stop - start) / Math.max(0, count),
      power = Math.floor(Math.log10(step)),
      error = step / Math.pow(10, power),
      factor = error >= e10 ? 10 : error >= e5 ? 5 : error >= e2 ? 2 : 1;
  let i1, i2, inc;
  if (power < 0) {
    inc = Math.pow(10, -power) / factor;
    i1 = Math.round(start * inc);
    i2 = Math.round(stop * inc);
    if (i1 / inc < start) ++i1;
    if (i2 / inc > stop) --i2;
    inc = -inc;
  } else {
    inc = Math.pow(10, power) * factor;
    i1 = Math.round(start / inc);
    i2 = Math.round(stop / inc);
    if (i1 * inc < start) ++i1;
    if (i2 * inc > stop) --i2;
  }
  if (i2 < i1 && 0.5 <= count && count < 2) return tickSpec(start, stop, count * 2);
  return [i1, i2, inc];
}

function ticks(start, stop, count) {
  stop = +stop, start = +start, count = +count;
  if (!(count > 0)) return [];
  if (start === stop) return [start];
  const reverse = stop < start, [i1, i2, inc] = reverse ? tickSpec(stop, start, count) : tickSpec(start, stop, count);
  if (!(i2 >= i1)) return [];
  const n = i2 - i1 + 1, ticks = new Array(n);
  if (reverse) {
    if (inc < 0) for (let i = 0; i < n; ++i) ticks[i] = (i2 - i) / -inc;
    else for (let i = 0; i < n; ++i) ticks[i] = (i2 - i) * inc;
  } else {
    if (inc < 0) for (let i = 0; i < n; ++i) ticks[i] = (i1 + i) / -inc;
    else for (let i = 0; i < n; ++i) ticks[i] = (i1 + i) * inc;
  }
  return ticks;
}

function tickIncrement(start, stop, count) {
  stop = +stop, start = +start, count = +count;
  return tickSpec(start, stop, count)[2];
}

function tickStep(start, stop, count) {
  stop = +stop, start = +start, count = +count;
  const reverse = stop < start, inc = reverse ? tickIncrement(stop, start, count) : tickIncrement(start, stop, count);
  return (reverse ? -1 : 1) * (inc < 0 ? 1 / -inc : inc);
}

function max(values, valueof) {
  let max;
  if (valueof === undefined) {
    for (const value of values) {
      if (value != null
          && (max < value || (max === undefined && value >= value))) {
        max = value;
      }
    }
  } else {
    let index = -1;
    for (let value of values) {
      if ((value = valueof(value, ++index, values)) != null
          && (max < value || (max === undefined && value >= value))) {
        max = value;
      }
    }
  }
  return max;
}

function range(start, stop, step) {
  start = +start, stop = +stop, step = (n = arguments.length) < 2 ? (stop = start, start = 0, 1) : n < 3 ? 1 : +step;

  var i = -1,
      n = Math.max(0, Math.ceil((stop - start) / step)) | 0,
      range = new Array(n);

  while (++i < n) {
    range[i] = start + i * step;
  }

  return range;
}

/**
	Calculate the unique values of desired fields
	For example, data like this:
	[{ x: 0, y: -10 }, { x: 10, y: 0 }, { x: 5, y: 10 }]
	and a fields object like this:
	`{'x': d => d.x, 'y': d => d.y}`
	returns an object like this:
	`{ x: [0, 10, 5], y: [-10, 0, 10] }`
	@param {Array} data A flat array of objects.
	@param {{x?: Function, y?: Function, z?: Function, r?: Function}} fields An object containing `x`, `y`, `r` or `z` keys that equal an accessor function. If an accessor function returns an array of values, each value will also be evaluated..
	@returns {{x?: [min: Number, max: Number]|[min: String, max: String], y?: [min: Number, max: Number]|[min: String, max: String], z?: [min: Number, max: Number]|[min: String, max: String], r?: [min: Number, max: Number]|[min: String, max: String]}} An object with the same structure as `fields` but instead of an accessor, each key contains an array of unique items.
*/

function calcUniques (data, fields, { sort = false } = {}) {
	if (!Array.isArray(data)) {
		throw new TypeError(`The first argument of calcUniques() must be an array. You passed in a ${typeof data}. If you got this error using the <LayerCake> component, consider passing a flat array to the \`flatData\` prop. More info: https://layercake.graphics/guide/#flatdata`);
	}

	if (
		Array.isArray(fields)
		|| fields === undefined
		|| fields === null
	) {
		throw new TypeError('The second argument of calcUniques() must be an '
		+ 'object with field names as keys as accessor functions as values.');
	}

	const uniques = {};

	const keys = Object.keys(fields);
	const kl = keys.length;
	let i;
	let j;
	let k;
	let s;
	let acc;
	let val;
	let set;

	const dl = data.length;
	for (i = 0; i < kl; i += 1) {
		set = new InternSet();
		s = keys[i];
		acc = fields[s];
		for (j = 0; j < dl; j += 1) {
			val = acc(data[j]);
			if (Array.isArray(val)) {
				const vl = val.length;
				for (k = 0; k < vl; k += 1) {
					set.add(val[k]);
				}
			} else {
				set.add(val);
			}
		}
		const results = Array.from(set);
		if (sort === true) {
			results.sort(ascending);
		}
		uniques[s] = results;
	}
	return uniques;
}

/**
	Calculate the extents of desired fields, skipping `false`, `undefined`, `null` and `NaN` values
	For example, data like this:
	[{ x: 0, y: -10 }, { x: 10, y: 0 }, { x: 5, y: 10 }]
	and a fields object like this:
	`{'x': d => d.x, 'y': d => d.y}`
	returns an object like this:
	`{ x: [0, 10], y: [-10, 10] }`
	@param {Array} data A flat array of objects.
	@param {{x?: Function, y?: Function, z?: Function, r?: Function}} fields An object containing `x`, `y`, `r` or `z` keys that equal an accessor function. If an accessor function returns an array of values, each value will also be evaluated.
	@returns {{x?: [min: Number, max: Number]|[min: String, max: String], y?: [min: Number, max: Number]|[min: String, max: String], z?: [min: Number, max: Number]|[min: String, max: String], r?: [min: Number, max: Number]|[min: String, max: String]}} An object with the same structure as `fields` but instead of an accessor, each key contains an array of a min and a max.
*/
function calcExtents (data, fields) {
	if (!Array.isArray(data)) {
		throw new TypeError(`The first argument of calcExtents() must be an array. You passed in a ${typeof data}. If you got this error using the <LayerCake> component, consider passing a flat array to the \`flatData\` prop. More info: https://layercake.graphics/guide/#flatdata`);
	}

	if (
		Array.isArray(fields)
		|| fields === undefined
		|| fields === null
	) {
		throw new TypeError('The second argument of calcExtents() must be an '
		+ 'object with field names as keys as accessor functions as values.');
	}

	const extents = {};

	const keys = Object.keys(fields);
	const kl = keys.length;
	let i;
	let j;
	let k;
	let s;
	let min;
	let max;
	let acc;
	let val;

	const dl = data.length;
	for (i = 0; i < kl; i += 1) {
		s = keys[i];
		acc = fields[s];
		min = null;
		max = null;
		for (j = 0; j < dl; j += 1) {
			val = acc(data[j]);
			if (Array.isArray(val)) {
				const vl = val.length;
				for (k = 0; k < vl; k += 1) {
					if (val[k] !== false && val[k] !== undefined && val[k] !== null && Number.isNaN(val[k]) === false) {
						if (min === null || val[k] < min) {
							min = val[k];
						}
						if (max === null || val[k] > max) {
							max = val[k];
						}
					}
				}
			} else if (val !== false && val !== undefined && val !== null && Number.isNaN(val) === false) {
				if (min === null || val < min) {
					min = val;
				}
				if (max === null || val > max) {
					max = val;
				}
			}
		}
		extents[s] = [min, max];
	}

	return extents;
}

/**
  Determine whether two arrays equal one another, order not important.
	This uses includes instead of converting to a set because this is only
	used internally on a small array size and it's not worth the cost
	of making a set
	@param {Array} arr1 An array to test
	@param {Array} arr2 An array to test against
	@returns {Boolean} Whether they contain all and only the same items
 */
function arraysEqual(arr1, arr2) {
	if (arr1.length !== arr2.length) return false;
	return arr1.every(k => {
		return arr2.includes(k);
	});
}

/**
  Determine whether a scale has an ordinal domain
	https://svelte.dev/repl/ec6491055208401ca41120c9c8a67737?version=3.49.0
	@param {Function} scale A D3 scale
	@returns {Boolean} Whether the scale is an ordinal scale
 */
function isOrdinalDomain(scale) {
	// scaleBand, scalePoint
	// @ts-ignore
	if (typeof scale.bandwidth === 'function') {
		return true;
	}
	// scaleOrdinal
	if (arraysEqual(Object.keys(scale), ['domain', 'range', 'unknown', 'copy'])) {
		return true;
	}
	return false;
}

/* --------------------------------------------
 * Figure out which of our scales are ordinal
 * and calculate unique items for them
 * for the others, calculate an extent
 */
function calcScaleExtents (flatData, getters, activeScales) {
	const scaleGroups = Object.keys(activeScales).reduce((groups, k) => {
		const domainType = isOrdinalDomain(activeScales[k]) === true ? 'ordinal' : 'other';
		// @ts-ignore
		if (!groups[domainType]) groups[domainType] = {};
		groups[domainType][k] = getters[k];
		return groups;
	}, { ordinal: false, other: false});

	let extents = {};
	if (scaleGroups.ordinal) {
		// @ts-ignore
		extents = calcUniques(flatData, scaleGroups.ordinal, { sort: true });
	}
	if (scaleGroups.other) {
		// @ts-ignore
		extents = { ...extents, ...calcExtents(flatData, scaleGroups.other) };
	}

	return extents;
}

/**
	If we have a domain from settings (the directive), fill in
	any null values with ones from our measured extents
	otherwise, return the measured extent
	@param {Number[]} domain A two-value array of numbers
	@param {Number[]} directive A two-value array of numbers that will have any nulls filled in from the `domain` array
	@returns {Number[]} The filled in domain
*/
function partialDomain (domain = [], directive) {
	if (Array.isArray(directive) === true) {
		return directive.map((d, i) => {
			if (d === null) {
				return domain[i];
			}
			return d;
		});
	}
	return domain;
}

function calcDomain (s) {
	return function domainCalc ([$extents, $domain]) {
		if (typeof $domain === 'function') {
			$domain = $domain($extents[s]);
		}
		return $extents ? partialDomain($extents[s], $domain) : $domain;
	};
}

function initRange(domain, range) {
  switch (arguments.length) {
    case 0: break;
    case 1: this.range(domain); break;
    default: this.range(range).domain(domain); break;
  }
  return this;
}

const implicit = Symbol("implicit");

function ordinal() {
  var index = new InternMap(),
      domain = [],
      range = [],
      unknown = implicit;

  function scale(d) {
    let i = index.get(d);
    if (i === undefined) {
      if (unknown !== implicit) return unknown;
      index.set(d, i = domain.push(d) - 1);
    }
    return range[i % range.length];
  }

  scale.domain = function(_) {
    if (!arguments.length) return domain.slice();
    domain = [], index = new InternMap();
    for (const value of _) {
      if (index.has(value)) continue;
      index.set(value, domain.push(value) - 1);
    }
    return scale;
  };

  scale.range = function(_) {
    return arguments.length ? (range = Array.from(_), scale) : range.slice();
  };

  scale.unknown = function(_) {
    return arguments.length ? (unknown = _, scale) : unknown;
  };

  scale.copy = function() {
    return ordinal(domain, range).unknown(unknown);
  };

  initRange.apply(scale, arguments);

  return scale;
}

function band() {
  var scale = ordinal().unknown(undefined),
      domain = scale.domain,
      ordinalRange = scale.range,
      r0 = 0,
      r1 = 1,
      step,
      bandwidth,
      round = false,
      paddingInner = 0,
      paddingOuter = 0,
      align = 0.5;

  delete scale.unknown;

  function rescale() {
    var n = domain().length,
        reverse = r1 < r0,
        start = reverse ? r1 : r0,
        stop = reverse ? r0 : r1;
    step = (stop - start) / Math.max(1, n - paddingInner + paddingOuter * 2);
    if (round) step = Math.floor(step);
    start += (stop - start - step * (n - paddingInner)) * align;
    bandwidth = step * (1 - paddingInner);
    if (round) start = Math.round(start), bandwidth = Math.round(bandwidth);
    var values = range(n).map(function(i) { return start + step * i; });
    return ordinalRange(reverse ? values.reverse() : values);
  }

  scale.domain = function(_) {
    return arguments.length ? (domain(_), rescale()) : domain();
  };

  scale.range = function(_) {
    return arguments.length ? ([r0, r1] = _, r0 = +r0, r1 = +r1, rescale()) : [r0, r1];
  };

  scale.rangeRound = function(_) {
    return [r0, r1] = _, r0 = +r0, r1 = +r1, round = true, rescale();
  };

  scale.bandwidth = function() {
    return bandwidth;
  };

  scale.step = function() {
    return step;
  };

  scale.round = function(_) {
    return arguments.length ? (round = !!_, rescale()) : round;
  };

  scale.padding = function(_) {
    return arguments.length ? (paddingInner = Math.min(1, paddingOuter = +_), rescale()) : paddingInner;
  };

  scale.paddingInner = function(_) {
    return arguments.length ? (paddingInner = Math.min(1, _), rescale()) : paddingInner;
  };

  scale.paddingOuter = function(_) {
    return arguments.length ? (paddingOuter = +_, rescale()) : paddingOuter;
  };

  scale.align = function(_) {
    return arguments.length ? (align = Math.max(0, Math.min(1, _)), rescale()) : align;
  };

  scale.copy = function() {
    return band(domain(), [r0, r1])
        .round(round)
        .paddingInner(paddingInner)
        .paddingOuter(paddingOuter)
        .align(align);
  };

  return initRange.apply(rescale(), arguments);
}

function define(constructor, factory, prototype) {
  constructor.prototype = factory.prototype = prototype;
  prototype.constructor = constructor;
}

function extend(parent, definition) {
  var prototype = Object.create(parent.prototype);
  for (var key in definition) prototype[key] = definition[key];
  return prototype;
}

function Color() {}

var darker = 0.7;
var brighter = 1 / darker;

var reI = "\\s*([+-]?\\d+)\\s*",
    reN = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)\\s*",
    reP = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*",
    reHex = /^#([0-9a-f]{3,8})$/,
    reRgbInteger = new RegExp(`^rgb\\(${reI},${reI},${reI}\\)$`),
    reRgbPercent = new RegExp(`^rgb\\(${reP},${reP},${reP}\\)$`),
    reRgbaInteger = new RegExp(`^rgba\\(${reI},${reI},${reI},${reN}\\)$`),
    reRgbaPercent = new RegExp(`^rgba\\(${reP},${reP},${reP},${reN}\\)$`),
    reHslPercent = new RegExp(`^hsl\\(${reN},${reP},${reP}\\)$`),
    reHslaPercent = new RegExp(`^hsla\\(${reN},${reP},${reP},${reN}\\)$`);

var named = {
  aliceblue: 0xf0f8ff,
  antiquewhite: 0xfaebd7,
  aqua: 0x00ffff,
  aquamarine: 0x7fffd4,
  azure: 0xf0ffff,
  beige: 0xf5f5dc,
  bisque: 0xffe4c4,
  black: 0x000000,
  blanchedalmond: 0xffebcd,
  blue: 0x0000ff,
  blueviolet: 0x8a2be2,
  brown: 0xa52a2a,
  burlywood: 0xdeb887,
  cadetblue: 0x5f9ea0,
  chartreuse: 0x7fff00,
  chocolate: 0xd2691e,
  coral: 0xff7f50,
  cornflowerblue: 0x6495ed,
  cornsilk: 0xfff8dc,
  crimson: 0xdc143c,
  cyan: 0x00ffff,
  darkblue: 0x00008b,
  darkcyan: 0x008b8b,
  darkgoldenrod: 0xb8860b,
  darkgray: 0xa9a9a9,
  darkgreen: 0x006400,
  darkgrey: 0xa9a9a9,
  darkkhaki: 0xbdb76b,
  darkmagenta: 0x8b008b,
  darkolivegreen: 0x556b2f,
  darkorange: 0xff8c00,
  darkorchid: 0x9932cc,
  darkred: 0x8b0000,
  darksalmon: 0xe9967a,
  darkseagreen: 0x8fbc8f,
  darkslateblue: 0x483d8b,
  darkslategray: 0x2f4f4f,
  darkslategrey: 0x2f4f4f,
  darkturquoise: 0x00ced1,
  darkviolet: 0x9400d3,
  deeppink: 0xff1493,
  deepskyblue: 0x00bfff,
  dimgray: 0x696969,
  dimgrey: 0x696969,
  dodgerblue: 0x1e90ff,
  firebrick: 0xb22222,
  floralwhite: 0xfffaf0,
  forestgreen: 0x228b22,
  fuchsia: 0xff00ff,
  gainsboro: 0xdcdcdc,
  ghostwhite: 0xf8f8ff,
  gold: 0xffd700,
  goldenrod: 0xdaa520,
  gray: 0x808080,
  green: 0x008000,
  greenyellow: 0xadff2f,
  grey: 0x808080,
  honeydew: 0xf0fff0,
  hotpink: 0xff69b4,
  indianred: 0xcd5c5c,
  indigo: 0x4b0082,
  ivory: 0xfffff0,
  khaki: 0xf0e68c,
  lavender: 0xe6e6fa,
  lavenderblush: 0xfff0f5,
  lawngreen: 0x7cfc00,
  lemonchiffon: 0xfffacd,
  lightblue: 0xadd8e6,
  lightcoral: 0xf08080,
  lightcyan: 0xe0ffff,
  lightgoldenrodyellow: 0xfafad2,
  lightgray: 0xd3d3d3,
  lightgreen: 0x90ee90,
  lightgrey: 0xd3d3d3,
  lightpink: 0xffb6c1,
  lightsalmon: 0xffa07a,
  lightseagreen: 0x20b2aa,
  lightskyblue: 0x87cefa,
  lightslategray: 0x778899,
  lightslategrey: 0x778899,
  lightsteelblue: 0xb0c4de,
  lightyellow: 0xffffe0,
  lime: 0x00ff00,
  limegreen: 0x32cd32,
  linen: 0xfaf0e6,
  magenta: 0xff00ff,
  maroon: 0x800000,
  mediumaquamarine: 0x66cdaa,
  mediumblue: 0x0000cd,
  mediumorchid: 0xba55d3,
  mediumpurple: 0x9370db,
  mediumseagreen: 0x3cb371,
  mediumslateblue: 0x7b68ee,
  mediumspringgreen: 0x00fa9a,
  mediumturquoise: 0x48d1cc,
  mediumvioletred: 0xc71585,
  midnightblue: 0x191970,
  mintcream: 0xf5fffa,
  mistyrose: 0xffe4e1,
  moccasin: 0xffe4b5,
  navajowhite: 0xffdead,
  navy: 0x000080,
  oldlace: 0xfdf5e6,
  olive: 0x808000,
  olivedrab: 0x6b8e23,
  orange: 0xffa500,
  orangered: 0xff4500,
  orchid: 0xda70d6,
  palegoldenrod: 0xeee8aa,
  palegreen: 0x98fb98,
  paleturquoise: 0xafeeee,
  palevioletred: 0xdb7093,
  papayawhip: 0xffefd5,
  peachpuff: 0xffdab9,
  peru: 0xcd853f,
  pink: 0xffc0cb,
  plum: 0xdda0dd,
  powderblue: 0xb0e0e6,
  purple: 0x800080,
  rebeccapurple: 0x663399,
  red: 0xff0000,
  rosybrown: 0xbc8f8f,
  royalblue: 0x4169e1,
  saddlebrown: 0x8b4513,
  salmon: 0xfa8072,
  sandybrown: 0xf4a460,
  seagreen: 0x2e8b57,
  seashell: 0xfff5ee,
  sienna: 0xa0522d,
  silver: 0xc0c0c0,
  skyblue: 0x87ceeb,
  slateblue: 0x6a5acd,
  slategray: 0x708090,
  slategrey: 0x708090,
  snow: 0xfffafa,
  springgreen: 0x00ff7f,
  steelblue: 0x4682b4,
  tan: 0xd2b48c,
  teal: 0x008080,
  thistle: 0xd8bfd8,
  tomato: 0xff6347,
  turquoise: 0x40e0d0,
  violet: 0xee82ee,
  wheat: 0xf5deb3,
  white: 0xffffff,
  whitesmoke: 0xf5f5f5,
  yellow: 0xffff00,
  yellowgreen: 0x9acd32
};

define(Color, color, {
  copy(channels) {
    return Object.assign(new this.constructor, this, channels);
  },
  displayable() {
    return this.rgb().displayable();
  },
  hex: color_formatHex, // Deprecated! Use color.formatHex.
  formatHex: color_formatHex,
  formatHex8: color_formatHex8,
  formatHsl: color_formatHsl,
  formatRgb: color_formatRgb,
  toString: color_formatRgb
});

function color_formatHex() {
  return this.rgb().formatHex();
}

function color_formatHex8() {
  return this.rgb().formatHex8();
}

function color_formatHsl() {
  return hslConvert(this).formatHsl();
}

function color_formatRgb() {
  return this.rgb().formatRgb();
}

function color(format) {
  var m, l;
  format = (format + "").trim().toLowerCase();
  return (m = reHex.exec(format)) ? (l = m[1].length, m = parseInt(m[1], 16), l === 6 ? rgbn(m) // #ff0000
      : l === 3 ? new Rgb((m >> 8 & 0xf) | (m >> 4 & 0xf0), (m >> 4 & 0xf) | (m & 0xf0), ((m & 0xf) << 4) | (m & 0xf), 1) // #f00
      : l === 8 ? rgba(m >> 24 & 0xff, m >> 16 & 0xff, m >> 8 & 0xff, (m & 0xff) / 0xff) // #ff000000
      : l === 4 ? rgba((m >> 12 & 0xf) | (m >> 8 & 0xf0), (m >> 8 & 0xf) | (m >> 4 & 0xf0), (m >> 4 & 0xf) | (m & 0xf0), (((m & 0xf) << 4) | (m & 0xf)) / 0xff) // #f000
      : null) // invalid hex
      : (m = reRgbInteger.exec(format)) ? new Rgb(m[1], m[2], m[3], 1) // rgb(255, 0, 0)
      : (m = reRgbPercent.exec(format)) ? new Rgb(m[1] * 255 / 100, m[2] * 255 / 100, m[3] * 255 / 100, 1) // rgb(100%, 0%, 0%)
      : (m = reRgbaInteger.exec(format)) ? rgba(m[1], m[2], m[3], m[4]) // rgba(255, 0, 0, 1)
      : (m = reRgbaPercent.exec(format)) ? rgba(m[1] * 255 / 100, m[2] * 255 / 100, m[3] * 255 / 100, m[4]) // rgb(100%, 0%, 0%, 1)
      : (m = reHslPercent.exec(format)) ? hsla(m[1], m[2] / 100, m[3] / 100, 1) // hsl(120, 50%, 50%)
      : (m = reHslaPercent.exec(format)) ? hsla(m[1], m[2] / 100, m[3] / 100, m[4]) // hsla(120, 50%, 50%, 1)
      : named.hasOwnProperty(format) ? rgbn(named[format]) // eslint-disable-line no-prototype-builtins
      : format === "transparent" ? new Rgb(NaN, NaN, NaN, 0)
      : null;
}

function rgbn(n) {
  return new Rgb(n >> 16 & 0xff, n >> 8 & 0xff, n & 0xff, 1);
}

function rgba(r, g, b, a) {
  if (a <= 0) r = g = b = NaN;
  return new Rgb(r, g, b, a);
}

function rgbConvert(o) {
  if (!(o instanceof Color)) o = color(o);
  if (!o) return new Rgb;
  o = o.rgb();
  return new Rgb(o.r, o.g, o.b, o.opacity);
}

function rgb$1(r, g, b, opacity) {
  return arguments.length === 1 ? rgbConvert(r) : new Rgb(r, g, b, opacity == null ? 1 : opacity);
}

function Rgb(r, g, b, opacity) {
  this.r = +r;
  this.g = +g;
  this.b = +b;
  this.opacity = +opacity;
}

define(Rgb, rgb$1, extend(Color, {
  brighter(k) {
    k = k == null ? brighter : Math.pow(brighter, k);
    return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
  },
  darker(k) {
    k = k == null ? darker : Math.pow(darker, k);
    return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
  },
  rgb() {
    return this;
  },
  clamp() {
    return new Rgb(clampi(this.r), clampi(this.g), clampi(this.b), clampa(this.opacity));
  },
  displayable() {
    return (-0.5 <= this.r && this.r < 255.5)
        && (-0.5 <= this.g && this.g < 255.5)
        && (-0.5 <= this.b && this.b < 255.5)
        && (0 <= this.opacity && this.opacity <= 1);
  },
  hex: rgb_formatHex, // Deprecated! Use color.formatHex.
  formatHex: rgb_formatHex,
  formatHex8: rgb_formatHex8,
  formatRgb: rgb_formatRgb,
  toString: rgb_formatRgb
}));

function rgb_formatHex() {
  return `#${hex(this.r)}${hex(this.g)}${hex(this.b)}`;
}

function rgb_formatHex8() {
  return `#${hex(this.r)}${hex(this.g)}${hex(this.b)}${hex((isNaN(this.opacity) ? 1 : this.opacity) * 255)}`;
}

function rgb_formatRgb() {
  const a = clampa(this.opacity);
  return `${a === 1 ? "rgb(" : "rgba("}${clampi(this.r)}, ${clampi(this.g)}, ${clampi(this.b)}${a === 1 ? ")" : `, ${a})`}`;
}

function clampa(opacity) {
  return isNaN(opacity) ? 1 : Math.max(0, Math.min(1, opacity));
}

function clampi(value) {
  return Math.max(0, Math.min(255, Math.round(value) || 0));
}

function hex(value) {
  value = clampi(value);
  return (value < 16 ? "0" : "") + value.toString(16);
}

function hsla(h, s, l, a) {
  if (a <= 0) h = s = l = NaN;
  else if (l <= 0 || l >= 1) h = s = NaN;
  else if (s <= 0) h = NaN;
  return new Hsl(h, s, l, a);
}

function hslConvert(o) {
  if (o instanceof Hsl) return new Hsl(o.h, o.s, o.l, o.opacity);
  if (!(o instanceof Color)) o = color(o);
  if (!o) return new Hsl;
  if (o instanceof Hsl) return o;
  o = o.rgb();
  var r = o.r / 255,
      g = o.g / 255,
      b = o.b / 255,
      min = Math.min(r, g, b),
      max = Math.max(r, g, b),
      h = NaN,
      s = max - min,
      l = (max + min) / 2;
  if (s) {
    if (r === max) h = (g - b) / s + (g < b) * 6;
    else if (g === max) h = (b - r) / s + 2;
    else h = (r - g) / s + 4;
    s /= l < 0.5 ? max + min : 2 - max - min;
    h *= 60;
  } else {
    s = l > 0 && l < 1 ? 0 : h;
  }
  return new Hsl(h, s, l, o.opacity);
}

function hsl(h, s, l, opacity) {
  return arguments.length === 1 ? hslConvert(h) : new Hsl(h, s, l, opacity == null ? 1 : opacity);
}

function Hsl(h, s, l, opacity) {
  this.h = +h;
  this.s = +s;
  this.l = +l;
  this.opacity = +opacity;
}

define(Hsl, hsl, extend(Color, {
  brighter(k) {
    k = k == null ? brighter : Math.pow(brighter, k);
    return new Hsl(this.h, this.s, this.l * k, this.opacity);
  },
  darker(k) {
    k = k == null ? darker : Math.pow(darker, k);
    return new Hsl(this.h, this.s, this.l * k, this.opacity);
  },
  rgb() {
    var h = this.h % 360 + (this.h < 0) * 360,
        s = isNaN(h) || isNaN(this.s) ? 0 : this.s,
        l = this.l,
        m2 = l + (l < 0.5 ? l : 1 - l) * s,
        m1 = 2 * l - m2;
    return new Rgb(
      hsl2rgb(h >= 240 ? h - 240 : h + 120, m1, m2),
      hsl2rgb(h, m1, m2),
      hsl2rgb(h < 120 ? h + 240 : h - 120, m1, m2),
      this.opacity
    );
  },
  clamp() {
    return new Hsl(clamph(this.h), clampt(this.s), clampt(this.l), clampa(this.opacity));
  },
  displayable() {
    return (0 <= this.s && this.s <= 1 || isNaN(this.s))
        && (0 <= this.l && this.l <= 1)
        && (0 <= this.opacity && this.opacity <= 1);
  },
  formatHsl() {
    const a = clampa(this.opacity);
    return `${a === 1 ? "hsl(" : "hsla("}${clamph(this.h)}, ${clampt(this.s) * 100}%, ${clampt(this.l) * 100}%${a === 1 ? ")" : `, ${a})`}`;
  }
}));

function clamph(value) {
  value = (value || 0) % 360;
  return value < 0 ? value + 360 : value;
}

function clampt(value) {
  return Math.max(0, Math.min(1, value || 0));
}

/* From FvD 13.37, CSS Color Module Level 3 */
function hsl2rgb(h, m1, m2) {
  return (h < 60 ? m1 + (m2 - m1) * h / 60
      : h < 180 ? m2
      : h < 240 ? m1 + (m2 - m1) * (240 - h) / 60
      : m1) * 255;
}

var constant$1 = x => () => x;

function linear$1(a, d) {
  return function(t) {
    return a + t * d;
  };
}

function exponential(a, b, y) {
  return a = Math.pow(a, y), b = Math.pow(b, y) - a, y = 1 / y, function(t) {
    return Math.pow(a + t * b, y);
  };
}

function gamma(y) {
  return (y = +y) === 1 ? nogamma : function(a, b) {
    return b - a ? exponential(a, b, y) : constant$1(isNaN(a) ? b : a);
  };
}

function nogamma(a, b) {
  var d = b - a;
  return d ? linear$1(a, d) : constant$1(isNaN(a) ? b : a);
}

var rgb = (function rgbGamma(y) {
  var color = gamma(y);

  function rgb(start, end) {
    var r = color((start = rgb$1(start)).r, (end = rgb$1(end)).r),
        g = color(start.g, end.g),
        b = color(start.b, end.b),
        opacity = nogamma(start.opacity, end.opacity);
    return function(t) {
      start.r = r(t);
      start.g = g(t);
      start.b = b(t);
      start.opacity = opacity(t);
      return start + "";
    };
  }

  rgb.gamma = rgbGamma;

  return rgb;
})(1);

function numberArray(a, b) {
  if (!b) b = [];
  var n = a ? Math.min(b.length, a.length) : 0,
      c = b.slice(),
      i;
  return function(t) {
    for (i = 0; i < n; ++i) c[i] = a[i] * (1 - t) + b[i] * t;
    return c;
  };
}

function isNumberArray(x) {
  return ArrayBuffer.isView(x) && !(x instanceof DataView);
}

function genericArray(a, b) {
  var nb = b ? b.length : 0,
      na = a ? Math.min(nb, a.length) : 0,
      x = new Array(na),
      c = new Array(nb),
      i;

  for (i = 0; i < na; ++i) x[i] = interpolate(a[i], b[i]);
  for (; i < nb; ++i) c[i] = b[i];

  return function(t) {
    for (i = 0; i < na; ++i) c[i] = x[i](t);
    return c;
  };
}

function date(a, b) {
  var d = new Date;
  return a = +a, b = +b, function(t) {
    return d.setTime(a * (1 - t) + b * t), d;
  };
}

function interpolateNumber(a, b) {
  return a = +a, b = +b, function(t) {
    return a * (1 - t) + b * t;
  };
}

function object(a, b) {
  var i = {},
      c = {},
      k;

  if (a === null || typeof a !== "object") a = {};
  if (b === null || typeof b !== "object") b = {};

  for (k in b) {
    if (k in a) {
      i[k] = interpolate(a[k], b[k]);
    } else {
      c[k] = b[k];
    }
  }

  return function(t) {
    for (k in i) c[k] = i[k](t);
    return c;
  };
}

var reA = /[-+]?(?:\d+\.?\d*|\.?\d+)(?:[eE][-+]?\d+)?/g,
    reB = new RegExp(reA.source, "g");

function zero(b) {
  return function() {
    return b;
  };
}

function one(b) {
  return function(t) {
    return b(t) + "";
  };
}

function string(a, b) {
  var bi = reA.lastIndex = reB.lastIndex = 0, // scan index for next number in b
      am, // current match in a
      bm, // current match in b
      bs, // string preceding current number in b, if any
      i = -1, // index in s
      s = [], // string constants and placeholders
      q = []; // number interpolators

  // Coerce inputs to strings.
  a = a + "", b = b + "";

  // Interpolate pairs of numbers in a & b.
  while ((am = reA.exec(a))
      && (bm = reB.exec(b))) {
    if ((bs = bm.index) > bi) { // a string precedes the next number in b
      bs = b.slice(bi, bs);
      if (s[i]) s[i] += bs; // coalesce with previous string
      else s[++i] = bs;
    }
    if ((am = am[0]) === (bm = bm[0])) { // numbers in a & b match
      if (s[i]) s[i] += bm; // coalesce with previous string
      else s[++i] = bm;
    } else { // interpolate non-matching numbers
      s[++i] = null;
      q.push({i: i, x: interpolateNumber(am, bm)});
    }
    bi = reB.lastIndex;
  }

  // Add remains of b.
  if (bi < b.length) {
    bs = b.slice(bi);
    if (s[i]) s[i] += bs; // coalesce with previous string
    else s[++i] = bs;
  }

  // Special optimization for only a single match.
  // Otherwise, interpolate each of the numbers and rejoin the string.
  return s.length < 2 ? (q[0]
      ? one(q[0].x)
      : zero(b))
      : (b = q.length, function(t) {
          for (var i = 0, o; i < b; ++i) s[(o = q[i]).i] = o.x(t);
          return s.join("");
        });
}

function interpolate(a, b) {
  var t = typeof b, c;
  return b == null || t === "boolean" ? constant$1(b)
      : (t === "number" ? interpolateNumber
      : t === "string" ? ((c = color(b)) ? (b = c, rgb) : string)
      : b instanceof color ? rgb
      : b instanceof Date ? date
      : isNumberArray(b) ? numberArray
      : Array.isArray(b) ? genericArray
      : typeof b.valueOf !== "function" && typeof b.toString !== "function" || isNaN(b) ? object
      : interpolateNumber)(a, b);
}

function interpolateRound(a, b) {
  return a = +a, b = +b, function(t) {
    return Math.round(a * (1 - t) + b * t);
  };
}

function constants(x) {
  return function() {
    return x;
  };
}

function number(x) {
  return +x;
}

var unit = [0, 1];

function identity$2(x) {
  return x;
}

function normalize(a, b) {
  return (b -= (a = +a))
      ? function(x) { return (x - a) / b; }
      : constants(isNaN(b) ? NaN : 0.5);
}

function clamper(a, b) {
  var t;
  if (a > b) t = a, a = b, b = t;
  return function(x) { return Math.max(a, Math.min(b, x)); };
}

// normalize(a, b)(x) takes a domain value x in [a,b] and returns the corresponding parameter t in [0,1].
// interpolate(a, b)(t) takes a parameter t in [0,1] and returns the corresponding range value x in [a,b].
function bimap(domain, range, interpolate) {
  var d0 = domain[0], d1 = domain[1], r0 = range[0], r1 = range[1];
  if (d1 < d0) d0 = normalize(d1, d0), r0 = interpolate(r1, r0);
  else d0 = normalize(d0, d1), r0 = interpolate(r0, r1);
  return function(x) { return r0(d0(x)); };
}

function polymap(domain, range, interpolate) {
  var j = Math.min(domain.length, range.length) - 1,
      d = new Array(j),
      r = new Array(j),
      i = -1;

  // Reverse descending domains.
  if (domain[j] < domain[0]) {
    domain = domain.slice().reverse();
    range = range.slice().reverse();
  }

  while (++i < j) {
    d[i] = normalize(domain[i], domain[i + 1]);
    r[i] = interpolate(range[i], range[i + 1]);
  }

  return function(x) {
    var i = bisect(domain, x, 1, j) - 1;
    return r[i](d[i](x));
  };
}

function copy(source, target) {
  return target
      .domain(source.domain())
      .range(source.range())
      .interpolate(source.interpolate())
      .clamp(source.clamp())
      .unknown(source.unknown());
}

function transformer() {
  var domain = unit,
      range = unit,
      interpolate$1 = interpolate,
      transform,
      untransform,
      unknown,
      clamp = identity$2,
      piecewise,
      output,
      input;

  function rescale() {
    var n = Math.min(domain.length, range.length);
    if (clamp !== identity$2) clamp = clamper(domain[0], domain[n - 1]);
    piecewise = n > 2 ? polymap : bimap;
    output = input = null;
    return scale;
  }

  function scale(x) {
    return x == null || isNaN(x = +x) ? unknown : (output || (output = piecewise(domain.map(transform), range, interpolate$1)))(transform(clamp(x)));
  }

  scale.invert = function(y) {
    return clamp(untransform((input || (input = piecewise(range, domain.map(transform), interpolateNumber)))(y)));
  };

  scale.domain = function(_) {
    return arguments.length ? (domain = Array.from(_, number), rescale()) : domain.slice();
  };

  scale.range = function(_) {
    return arguments.length ? (range = Array.from(_), rescale()) : range.slice();
  };

  scale.rangeRound = function(_) {
    return range = Array.from(_), interpolate$1 = interpolateRound, rescale();
  };

  scale.clamp = function(_) {
    return arguments.length ? (clamp = _ ? true : identity$2, rescale()) : clamp !== identity$2;
  };

  scale.interpolate = function(_) {
    return arguments.length ? (interpolate$1 = _, rescale()) : interpolate$1;
  };

  scale.unknown = function(_) {
    return arguments.length ? (unknown = _, scale) : unknown;
  };

  return function(t, u) {
    transform = t, untransform = u;
    return rescale();
  };
}

function continuous() {
  return transformer()(identity$2, identity$2);
}

function formatDecimal(x) {
  return Math.abs(x = Math.round(x)) >= 1e21
      ? x.toLocaleString("en").replace(/,/g, "")
      : x.toString(10);
}

// Computes the decimal coefficient and exponent of the specified number x with
// significant digits p, where x is positive and p is in [1, 21] or undefined.
// For example, formatDecimalParts(1.23) returns ["123", 0].
function formatDecimalParts(x, p) {
  if ((i = (x = p ? x.toExponential(p - 1) : x.toExponential()).indexOf("e")) < 0) return null; // NaN, ±Infinity
  var i, coefficient = x.slice(0, i);

  // The string returned by toExponential either has the form \d\.\d+e[-+]\d+
  // (e.g., 1.2e+3) or the form \de[-+]\d+ (e.g., 1e+3).
  return [
    coefficient.length > 1 ? coefficient[0] + coefficient.slice(2) : coefficient,
    +x.slice(i + 1)
  ];
}

function exponent(x) {
  return x = formatDecimalParts(Math.abs(x)), x ? x[1] : NaN;
}

function formatGroup(grouping, thousands) {
  return function(value, width) {
    var i = value.length,
        t = [],
        j = 0,
        g = grouping[0],
        length = 0;

    while (i > 0 && g > 0) {
      if (length + g + 1 > width) g = Math.max(1, width - length);
      t.push(value.substring(i -= g, i + g));
      if ((length += g + 1) > width) break;
      g = grouping[j = (j + 1) % grouping.length];
    }

    return t.reverse().join(thousands);
  };
}

function formatNumerals(numerals) {
  return function(value) {
    return value.replace(/[0-9]/g, function(i) {
      return numerals[+i];
    });
  };
}

// [[fill]align][sign][symbol][0][width][,][.precision][~][type]
var re = /^(?:(.)?([<>=^]))?([+\-( ])?([$#])?(0)?(\d+)?(,)?(\.\d+)?(~)?([a-z%])?$/i;

function formatSpecifier(specifier) {
  if (!(match = re.exec(specifier))) throw new Error("invalid format: " + specifier);
  var match;
  return new FormatSpecifier({
    fill: match[1],
    align: match[2],
    sign: match[3],
    symbol: match[4],
    zero: match[5],
    width: match[6],
    comma: match[7],
    precision: match[8] && match[8].slice(1),
    trim: match[9],
    type: match[10]
  });
}

formatSpecifier.prototype = FormatSpecifier.prototype; // instanceof

function FormatSpecifier(specifier) {
  this.fill = specifier.fill === undefined ? " " : specifier.fill + "";
  this.align = specifier.align === undefined ? ">" : specifier.align + "";
  this.sign = specifier.sign === undefined ? "-" : specifier.sign + "";
  this.symbol = specifier.symbol === undefined ? "" : specifier.symbol + "";
  this.zero = !!specifier.zero;
  this.width = specifier.width === undefined ? undefined : +specifier.width;
  this.comma = !!specifier.comma;
  this.precision = specifier.precision === undefined ? undefined : +specifier.precision;
  this.trim = !!specifier.trim;
  this.type = specifier.type === undefined ? "" : specifier.type + "";
}

FormatSpecifier.prototype.toString = function() {
  return this.fill
      + this.align
      + this.sign
      + this.symbol
      + (this.zero ? "0" : "")
      + (this.width === undefined ? "" : Math.max(1, this.width | 0))
      + (this.comma ? "," : "")
      + (this.precision === undefined ? "" : "." + Math.max(0, this.precision | 0))
      + (this.trim ? "~" : "")
      + this.type;
};

// Trims insignificant zeros, e.g., replaces 1.2000k with 1.2k.
function formatTrim(s) {
  out: for (var n = s.length, i = 1, i0 = -1, i1; i < n; ++i) {
    switch (s[i]) {
      case ".": i0 = i1 = i; break;
      case "0": if (i0 === 0) i0 = i; i1 = i; break;
      default: if (!+s[i]) break out; if (i0 > 0) i0 = 0; break;
    }
  }
  return i0 > 0 ? s.slice(0, i0) + s.slice(i1 + 1) : s;
}

var prefixExponent;

function formatPrefixAuto(x, p) {
  var d = formatDecimalParts(x, p);
  if (!d) return x + "";
  var coefficient = d[0],
      exponent = d[1],
      i = exponent - (prefixExponent = Math.max(-8, Math.min(8, Math.floor(exponent / 3))) * 3) + 1,
      n = coefficient.length;
  return i === n ? coefficient
      : i > n ? coefficient + new Array(i - n + 1).join("0")
      : i > 0 ? coefficient.slice(0, i) + "." + coefficient.slice(i)
      : "0." + new Array(1 - i).join("0") + formatDecimalParts(x, Math.max(0, p + i - 1))[0]; // less than 1y!
}

function formatRounded(x, p) {
  var d = formatDecimalParts(x, p);
  if (!d) return x + "";
  var coefficient = d[0],
      exponent = d[1];
  return exponent < 0 ? "0." + new Array(-exponent).join("0") + coefficient
      : coefficient.length > exponent + 1 ? coefficient.slice(0, exponent + 1) + "." + coefficient.slice(exponent + 1)
      : coefficient + new Array(exponent - coefficient.length + 2).join("0");
}

var formatTypes = {
  "%": (x, p) => (x * 100).toFixed(p),
  "b": (x) => Math.round(x).toString(2),
  "c": (x) => x + "",
  "d": formatDecimal,
  "e": (x, p) => x.toExponential(p),
  "f": (x, p) => x.toFixed(p),
  "g": (x, p) => x.toPrecision(p),
  "o": (x) => Math.round(x).toString(8),
  "p": (x, p) => formatRounded(x * 100, p),
  "r": formatRounded,
  "s": formatPrefixAuto,
  "X": (x) => Math.round(x).toString(16).toUpperCase(),
  "x": (x) => Math.round(x).toString(16)
};

function identity$1(x) {
  return x;
}

var map = Array.prototype.map,
    prefixes = ["y","z","a","f","p","n","µ","m","","k","M","G","T","P","E","Z","Y"];

function formatLocale(locale) {
  var group = locale.grouping === undefined || locale.thousands === undefined ? identity$1 : formatGroup(map.call(locale.grouping, Number), locale.thousands + ""),
      currencyPrefix = locale.currency === undefined ? "" : locale.currency[0] + "",
      currencySuffix = locale.currency === undefined ? "" : locale.currency[1] + "",
      decimal = locale.decimal === undefined ? "." : locale.decimal + "",
      numerals = locale.numerals === undefined ? identity$1 : formatNumerals(map.call(locale.numerals, String)),
      percent = locale.percent === undefined ? "%" : locale.percent + "",
      minus = locale.minus === undefined ? "−" : locale.minus + "",
      nan = locale.nan === undefined ? "NaN" : locale.nan + "";

  function newFormat(specifier) {
    specifier = formatSpecifier(specifier);

    var fill = specifier.fill,
        align = specifier.align,
        sign = specifier.sign,
        symbol = specifier.symbol,
        zero = specifier.zero,
        width = specifier.width,
        comma = specifier.comma,
        precision = specifier.precision,
        trim = specifier.trim,
        type = specifier.type;

    // The "n" type is an alias for ",g".
    if (type === "n") comma = true, type = "g";

    // The "" type, and any invalid type, is an alias for ".12~g".
    else if (!formatTypes[type]) precision === undefined && (precision = 12), trim = true, type = "g";

    // If zero fill is specified, padding goes after sign and before digits.
    if (zero || (fill === "0" && align === "=")) zero = true, fill = "0", align = "=";

    // Compute the prefix and suffix.
    // For SI-prefix, the suffix is lazily computed.
    var prefix = symbol === "$" ? currencyPrefix : symbol === "#" && /[boxX]/.test(type) ? "0" + type.toLowerCase() : "",
        suffix = symbol === "$" ? currencySuffix : /[%p]/.test(type) ? percent : "";

    // What format function should we use?
    // Is this an integer type?
    // Can this type generate exponential notation?
    var formatType = formatTypes[type],
        maybeSuffix = /[defgprs%]/.test(type);

    // Set the default precision if not specified,
    // or clamp the specified precision to the supported range.
    // For significant precision, it must be in [1, 21].
    // For fixed precision, it must be in [0, 20].
    precision = precision === undefined ? 6
        : /[gprs]/.test(type) ? Math.max(1, Math.min(21, precision))
        : Math.max(0, Math.min(20, precision));

    function format(value) {
      var valuePrefix = prefix,
          valueSuffix = suffix,
          i, n, c;

      if (type === "c") {
        valueSuffix = formatType(value) + valueSuffix;
        value = "";
      } else {
        value = +value;

        // Determine the sign. -0 is not less than 0, but 1 / -0 is!
        var valueNegative = value < 0 || 1 / value < 0;

        // Perform the initial formatting.
        value = isNaN(value) ? nan : formatType(Math.abs(value), precision);

        // Trim insignificant zeros.
        if (trim) value = formatTrim(value);

        // If a negative value rounds to zero after formatting, and no explicit positive sign is requested, hide the sign.
        if (valueNegative && +value === 0 && sign !== "+") valueNegative = false;

        // Compute the prefix and suffix.
        valuePrefix = (valueNegative ? (sign === "(" ? sign : minus) : sign === "-" || sign === "(" ? "" : sign) + valuePrefix;
        valueSuffix = (type === "s" ? prefixes[8 + prefixExponent / 3] : "") + valueSuffix + (valueNegative && sign === "(" ? ")" : "");

        // Break the formatted value into the integer “value” part that can be
        // grouped, and fractional or exponential “suffix” part that is not.
        if (maybeSuffix) {
          i = -1, n = value.length;
          while (++i < n) {
            if (c = value.charCodeAt(i), 48 > c || c > 57) {
              valueSuffix = (c === 46 ? decimal + value.slice(i + 1) : value.slice(i)) + valueSuffix;
              value = value.slice(0, i);
              break;
            }
          }
        }
      }

      // If the fill character is not "0", grouping is applied before padding.
      if (comma && !zero) value = group(value, Infinity);

      // Compute the padding.
      var length = valuePrefix.length + value.length + valueSuffix.length,
          padding = length < width ? new Array(width - length + 1).join(fill) : "";

      // If the fill character is "0", grouping is applied after padding.
      if (comma && zero) value = group(padding + value, padding.length ? width - valueSuffix.length : Infinity), padding = "";

      // Reconstruct the final output based on the desired alignment.
      switch (align) {
        case "<": value = valuePrefix + value + valueSuffix + padding; break;
        case "=": value = valuePrefix + padding + value + valueSuffix; break;
        case "^": value = padding.slice(0, length = padding.length >> 1) + valuePrefix + value + valueSuffix + padding.slice(length); break;
        default: value = padding + valuePrefix + value + valueSuffix; break;
      }

      return numerals(value);
    }

    format.toString = function() {
      return specifier + "";
    };

    return format;
  }

  function formatPrefix(specifier, value) {
    var f = newFormat((specifier = formatSpecifier(specifier), specifier.type = "f", specifier)),
        e = Math.max(-8, Math.min(8, Math.floor(exponent(value) / 3))) * 3,
        k = Math.pow(10, -e),
        prefix = prefixes[8 + e / 3];
    return function(value) {
      return f(k * value) + prefix;
    };
  }

  return {
    format: newFormat,
    formatPrefix: formatPrefix
  };
}

var locale;
var format;
var formatPrefix;

defaultLocale({
  thousands: ",",
  grouping: [3],
  currency: ["$", ""]
});

function defaultLocale(definition) {
  locale = formatLocale(definition);
  format = locale.format;
  formatPrefix = locale.formatPrefix;
  return locale;
}

function precisionFixed(step) {
  return Math.max(0, -exponent(Math.abs(step)));
}

function precisionPrefix(step, value) {
  return Math.max(0, Math.max(-8, Math.min(8, Math.floor(exponent(value) / 3))) * 3 - exponent(Math.abs(step)));
}

function precisionRound(step, max) {
  step = Math.abs(step), max = Math.abs(max) - step;
  return Math.max(0, exponent(max) - exponent(step)) + 1;
}

function tickFormat(start, stop, count, specifier) {
  var step = tickStep(start, stop, count),
      precision;
  specifier = formatSpecifier(specifier == null ? ",f" : specifier);
  switch (specifier.type) {
    case "s": {
      var value = Math.max(Math.abs(start), Math.abs(stop));
      if (specifier.precision == null && !isNaN(precision = precisionPrefix(step, value))) specifier.precision = precision;
      return formatPrefix(specifier, value);
    }
    case "":
    case "e":
    case "g":
    case "p":
    case "r": {
      if (specifier.precision == null && !isNaN(precision = precisionRound(step, Math.max(Math.abs(start), Math.abs(stop))))) specifier.precision = precision - (specifier.type === "e");
      break;
    }
    case "f":
    case "%": {
      if (specifier.precision == null && !isNaN(precision = precisionFixed(step))) specifier.precision = precision - (specifier.type === "%") * 2;
      break;
    }
  }
  return format(specifier);
}

function linearish(scale) {
  var domain = scale.domain;

  scale.ticks = function(count) {
    var d = domain();
    return ticks(d[0], d[d.length - 1], count == null ? 10 : count);
  };

  scale.tickFormat = function(count, specifier) {
    var d = domain();
    return tickFormat(d[0], d[d.length - 1], count == null ? 10 : count, specifier);
  };

  scale.nice = function(count) {
    if (count == null) count = 10;

    var d = domain();
    var i0 = 0;
    var i1 = d.length - 1;
    var start = d[i0];
    var stop = d[i1];
    var prestep;
    var step;
    var maxIter = 10;

    if (stop < start) {
      step = start, start = stop, stop = step;
      step = i0, i0 = i1, i1 = step;
    }
    
    while (maxIter-- > 0) {
      step = tickIncrement(start, stop, count);
      if (step === prestep) {
        d[i0] = start;
        d[i1] = stop;
        return domain(d);
      } else if (step > 0) {
        start = Math.floor(start / step) * step;
        stop = Math.ceil(stop / step) * step;
      } else if (step < 0) {
        start = Math.ceil(start * step) / step;
        stop = Math.floor(stop * step) / step;
      } else {
        break;
      }
      prestep = step;
    }

    return scale;
  };

  return scale;
}

function linear() {
  var scale = continuous();

  scale.copy = function() {
    return copy(scale, linear());
  };

  initRange.apply(scale, arguments);

  return linearish(scale);
}

function transformPow(exponent) {
  return function(x) {
    return x < 0 ? -Math.pow(-x, exponent) : Math.pow(x, exponent);
  };
}

function transformSqrt(x) {
  return x < 0 ? -Math.sqrt(-x) : Math.sqrt(x);
}

function transformSquare(x) {
  return x < 0 ? -x * x : x * x;
}

function powish(transform) {
  var scale = transform(identity$2, identity$2),
      exponent = 1;

  function rescale() {
    return exponent === 1 ? transform(identity$2, identity$2)
        : exponent === 0.5 ? transform(transformSqrt, transformSquare)
        : transform(transformPow(exponent), transformPow(1 / exponent));
  }

  scale.exponent = function(_) {
    return arguments.length ? (exponent = +_, rescale()) : exponent;
  };

  return linearish(scale);
}

function pow$1() {
  var scale = powish(transformer());

  scale.copy = function() {
    return copy(scale, pow$1()).exponent(scale.exponent());
  };

  initRange.apply(scale, arguments);

  return scale;
}

function sqrt() {
  return pow$1.apply(null, arguments).exponent(0.5);
}

var defaultScales = {
	x: linear,
	y: linear,
	z: linear,
	r: sqrt
};

/* --------------------------------------------
 *
 * Determine whether a scale is a log, symlog, power or other
 * This is not meant to be exhaustive of all the different types of
 * scales in d3-scale and focuses on continuous scales
 *
 * --------------------------------------------
 */
function findScaleType(scale) {
	if (scale.constant) {
		return 'symlog';
	}
	if (scale.base) {
		return 'log';
	}
	if (scale.exponent) {
		if (scale.exponent() === 0.5) {
			return 'sqrt';
		}
		return 'pow';
	}
	return 'other';
}

/**
	An identity function
	@param {any} d The value to return.
	@returns {any}
*/
function identity (d) {
	return d;
}

function log(sign) {
	return x => Math.log(sign * x);
}

function exp(sign) {
	return x => sign * Math.exp(x);
}

function symlog(c) {
	return x => Math.sign(x) * Math.log1p(Math.abs(x / c));
}

function symexp(c) {
	return x => Math.sign(x) * Math.expm1(Math.abs(x)) * c;
}

function pow(exponent) {
	return function powFn(x) {
		return x < 0 ? -Math.pow(-x, exponent) : Math.pow(x, exponent);
	};
}

function getPadFunctions(scale) {
	const scaleType = findScaleType(scale);

	if (scaleType === 'log') {
		const sign = Math.sign(scale.domain()[0]);
		return { lift: log(sign), ground: exp(sign), scaleType };
	}
	if (scaleType === 'pow') {
		const exponent = 1;
		return { lift: pow(exponent), ground: pow(1 / exponent), scaleType };
	}
	if (scaleType === 'sqrt') {
		const exponent = 0.5;
		return { lift: pow(exponent), ground: pow(1 / exponent), scaleType };
	}
	if (scaleType === 'symlog') {
		const constant = 1;
		return { lift: symlog(constant), ground: symexp(constant), scaleType };
	}

	return { lift: identity, ground: identity, scaleType };
}

function toTitleCase(str) {
	return str.replace(/^\w/, d => d.toUpperCase())
}

function f(name, modifier = '') {
	return `scale${toTitleCase(modifier)}${toTitleCase(name)}`;
}

/**
  Get a D3 scale name
	https://svelte.dev/repl/ec6491055208401ca41120c9c8a67737?version=3.49.0
	@param {Function} scale A D3 scale
	@returns {String} The scale's name
 */
function findScaleName(scale) {
	/**
	 * Ordinal scales
	 */
	// scaleBand, scalePoint
	// @ts-ignore
	if (typeof scale.bandwidth === 'function') {
		// @ts-ignore
		if (typeof scale.paddingInner === 'function') {
			return f('band');
		}
		return f('point');
	}
	// scaleOrdinal
	if (arraysEqual(Object.keys(scale), ['domain', 'range', 'unknown', 'copy'])) {
		return f('ordinal');
	}

	/**
	 * Sequential versus divergin
	 */
	let modifier = '';
	// @ts-ignore
	if (scale.interpolator) {
		// @ts-ignore
		if (scale.domain().length === 3) {
			modifier = 'diverging';
		} else {
			modifier = 'sequential';
		}
	}

	/**
	 * Continuous scales
	 */
	// @ts-ignore
	if (scale.quantiles) {
		return f('quantile', modifier);
	}
	// @ts-ignore
	if (scale.thresholds) {
		return f('quantize', modifier);
	}
	// @ts-ignore
	if (scale.constant) {
		return f('symlog', modifier);
	}
	// @ts-ignore
	if (scale.base) {
		return f('log', modifier);
	}
	// @ts-ignore
	if (scale.exponent) {
		// @ts-ignore
		if (scale.exponent() === 0.5) {
			return f('sqrt', modifier);
		}
		return f('pow', modifier);
	}

	if (arraysEqual(Object.keys(scale), ['domain', 'range', 'invertExtent', 'unknown', 'copy'])) {
		return f('threshold');
	}

	if (arraysEqual(Object.keys(scale), ['invert', 'range', 'domain', 'unknown', 'copy', 'ticks', 'tickFormat', 'nice'])) {
		return f('identity');
	}

	if (
		arraysEqual(Object.keys(scale), [
			'invert', 'domain', 'range', 'rangeRound', 'round', 'clamp', 'unknown', 'copy', 'ticks', 'tickFormat', 'nice'
		])
	) {
		return f('radial');
	}

	if (modifier) {
		return f(modifier);
	}

	/**
	 * Test for scaleTime vs scaleUtc
	 * https://github.com/d3/d3-scale/pull/274#issuecomment-1462935595
	 */
	// @ts-ignore
	if (scale.domain()[0] instanceof Date) {
		const d = new Date;
		let s;
		// @ts-ignore
		d.getDay = () => s = 'time';
		// @ts-ignore
		d.getUTCDay = () => s = 'utc';

		// @ts-ignore
		scale.tickFormat(0, '%a')(d);
		return f(s);
	}

	return f('linear');
}

/**
	Returns a modified scale domain by in/decreasing
	the min/max by taking the desired difference
	in pixels and converting it to units of data.
	Returns an array that you can set as the new domain.
	Padding contributed by @veltman.
	See here for discussion of transforms: https://github.com/d3/d3-scale/issues/150
	@param {Function} scale A D3 scale funcion
	@param {Number[]} padding A two-value array of numbers specifying padding in pixels
	@returns {Number[]} The padded domain
*/

// These scales have a discrete range so they can't be padded
const unpaddable = ['scaleThreshold', 'scaleQuantile', 'scaleQuantize', 'scaleSequentialQuantile'];

function padScale (scale, padding) {
	if (typeof scale.range !== 'function') {
		console.log(scale);
		throw new Error('Scale method `range` must be a function');
	}
	if (typeof scale.domain !== 'function') {
		throw new Error('Scale method `domain` must be a function');
	}

	if (!Array.isArray(padding) || unpaddable.includes(findScaleName(scale))) {
		return scale.domain();
	}

	if (isOrdinalDomain(scale) === true) {
		return scale.domain();
	}

	const { lift, ground } = getPadFunctions(scale);

	const d0 = scale.domain()[0];

	const isTime = Object.prototype.toString.call(d0) === '[object Date]';

	const [d1, d2] = scale.domain().map(d => {
		return isTime ? lift(d.getTime()) : lift(d);
	});
	const [r1, r2] = scale.range();
	const paddingLeft = padding[0] || 0;
	const paddingRight = padding[1] || 0;

	const step = (d2 - d1) / (Math.abs(r2 - r1) - paddingLeft - paddingRight); // Math.abs() to properly handle reversed scales

	return [d1 - paddingLeft * step, paddingRight * step + d2].map(d => {
		return isTime ? ground(new Date(d)) : ground(d);
	});
}

/* eslint-disable no-nested-ternary */
function calcBaseRange(s, width, height, reverse, percentRange) {
	let min;
	let max;
	if (percentRange === true) {
		min = 0;
		max = 100;
	} else {
		min = s === 'r' ? 1 : 0;
		max = s === 'y' ? height : s === 'r' ? 25 : width;
	}
	return reverse === true ? [max, min] : [min, max];
}

function getDefaultRange(s, width, height, reverse, range, percentRange) {
	return !range
		? calcBaseRange(s, width, height, reverse, percentRange)
		: typeof range === 'function'
			? range({ width, height })
			: range;
}

function createScale (s) {
	return function scaleCreator ([$scale, $extents, $domain, $padding, $nice, $reverse, $width, $height, $range, $percentScale]) {
		if ($extents === null) {
			return null;
		}

		const defaultRange = getDefaultRange(s, $width, $height, $reverse, $range, $percentScale);

		const scale = $scale === defaultScales[s] ? $scale() : $scale.copy();

		/* --------------------------------------------
		 * Set the domain
		 */
		scale.domain($domain);

		/* --------------------------------------------
		 * Set the range of the scale to our default if
		 * the scale doesn't have an interpolator function
		 * or if it does, still set the range if that function
		 * is the default identity function
		 */
		if (
			!scale.interpolator ||
			(
				typeof scale.interpolator === 'function'
				&& scale.interpolator().name.startsWith('identity')
			)
		) {
			scale.range(defaultRange);
		}

		if ($padding) {
			scale.domain(padScale(scale, $padding));
		}

		if ($nice === true || typeof $nice === 'number') {
			if (typeof scale.nice === 'function') {
				scale.nice(typeof $nice === 'number' ? $nice : undefined);
			} else {
				console.error(`[Layer Cake] You set \`${s}Nice: true\` but the ${s}Scale does not have a \`.nice\` method. Ignoring...`);
			}
		}

		return scale;
	};
}

function createGetter ([$acc, $scale]) {
	return d => {
		const val = $acc(d);
		if (Array.isArray(val)) {
			return val.map(v => $scale(v));
		}
		return $scale(val);
	};
}

function getRange([$scale]) {
	if (typeof $scale === 'function') {
		if (typeof $scale.range === 'function') {
			return $scale.range();
		}
		console.error('[LayerCake] Your scale doesn\'t have a `.range` method?');
	}
	return null;
}

const indent = '    ';

function getRgb(clr){
	const { r, g, b, opacity: o } = rgb$1(clr);
	if (![r, g, b].every(c => c >= 0 && c <= 255)) {
		return false;
	}
	return { r, g, b, o };
}

/**
 * Calculate human-perceived lightness from RGB
 * This doesn't take opacity into account
 * https://stackoverflow.com/a/596243
 */
function contrast({ r, g, b }) {
	const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
	return luminance > 0.6 ? 'black' : 'white';
}

/* --------------------------------------------
 *
 * Print out the values of an object
 * --------------------------------------------
 */
function printDebug(obj) {
	console.log('/********* LayerCake Debug ************/');
	console.log('Bounding box:');
	printObject(obj.boundingBox);
	console.log('Scales:\n');
	Object.keys(obj.activeGetters).forEach(g => {
		printScale(g, obj[`${g}Scale`], obj[g]);
	});
	console.log('/************ End LayerCake Debug ***************/\n');
}

function printObject(obj) {
	Object.entries(obj).forEach(([key, value]) => {
		console.log(`${indent}${key}:`, value);
	});
}

function printScale(s, scale, acc) {
	const scaleName = findScaleName(scale);
	console.log(`${indent}${s}:`);
	console.log(`${indent}${indent}Accessor: "${acc.toString()}"`);
	console.log(`${indent}${indent}Type: ${scaleName}`);
	printValues(scale, 'domain');
	printValues(scale, 'range', ' ');
}

function printValues(scale, method, extraSpace = '') {
	const values = scale[method]();
	const colorValues = colorizeArray(values);
	if (colorValues) {
		printColorArray(colorValues, method, values);
	} else {
		console.log(`${indent}${indent}${toTitleCase(method)}:${extraSpace}`, values);
	}
}

function printColorArray(colorValues, method, values) {
	console.log(
		`${indent}${indent}${toTitleCase(method)}:    %cArray%c(${values.length}) ` + colorValues[0] + '%c ]',
		'color: #1377e4',
		'color: #737373',
		'color: #1478e4',
		...colorValues[1],
		'color: #1478e4'
	);
}
function colorizeArray(arr) {
	const colors = [];
	const a = arr.map((d, i) => {
		const rgbo = getRgb(d);
		if (rgbo !== false) {
			colors.push(rgbo);
			// Add a space to the last item
			const space = i === arr.length - 1 ? ' ' : '';
			return `%c ${d}${space}`;
		}
		return d;
	});
	if (colors.length) {
		return [
			`%c[ ${a.join(', ')}`,
			colors.map(
				d => `background-color: rgba(${d.r}, ${d.g}, ${d.b}, ${d.o}); color:${contrast(d)};`
			)
		];
	}
	return null;
}

/* node_modules/layercake/dist/LayerCake.svelte generated by Svelte v4.2.9 */

const css$4 = {
	code: ".layercake-container.svelte-vhzpsp,.layercake-container.svelte-vhzpsp *{box-sizing:border-box}.layercake-container.svelte-vhzpsp{width:100%;height:100%}",
	map: "{\"version\":3,\"file\":\"LayerCake.svelte\",\"sources\":[\"LayerCake.svelte\"],\"sourcesContent\":[\"<script>\\n\\timport { setContext, onMount } from 'svelte';\\n\\timport { writable, derived } from 'svelte/store';\\n\\n\\timport makeAccessor from './utils/makeAccessor.js';\\n\\timport filterObject from './utils/filterObject.js';\\n\\timport debounce from './utils/debounce.js';\\n\\n\\timport calcScaleExtents from './helpers/calcScaleExtents.js';\\n\\timport calcDomain from './helpers/calcDomain.js';\\n\\timport createScale from './helpers/createScale.js';\\n\\timport createGetter from './helpers/createGetter.js';\\n\\timport getRange from './helpers/getRange.js';\\n\\timport printDebug from './helpers/printDebug.js';\\n\\n\\timport defaultScales from './settings/defaultScales.js';\\n\\n\\tconst printDebug_debounced = debounce(printDebug, 200);\\n\\n\\t/** @type {Boolean} [ssr=false] Whether this chart should be rendered server side. */\\n\\texport let ssr = false;\\n\\t/** @type {Boolean} [pointerEvents=true] Whether to allow pointer events via CSS. Set this to `false` to set `pointer-events: none;` on all components, disabling all mouse interaction. */\\n\\texport let pointerEvents = true;\\n\\t/** @type {String} [position='relative'] Determine the positioning of the wrapper div. Set this to `'absolute'` when you want to stack cakes. */\\n\\texport let position = 'relative';\\n\\t/** @type {Boolean} [percentRange=false] If `true`, set all scale ranges to `[0, 100]`. Ranges reversed via `xReverse`, `yReverse`, `zReverse` or `rReverse` props will continue to be reversed as usual. */\\n\\texport let percentRange = false;\\n\\n\\t/** @type {Number} [width=containerWidth] Override the automated width. */\\n\\texport let width = undefined;\\n\\t/** @type {Number} [height=containerHeight] Override the automated height. */\\n\\texport let height = undefined;\\n\\n\\t/** @type {Number} [containerWidth=100] The bound container width. */\\n\\texport let containerWidth = width || 100;\\n\\t/** @type {Number} [containerHeight=100] The bound container height. */\\n\\texport let containerHeight = height || 100;\\n\\n\\t/**\\t@type {Element} [element] The .layercake-container `<div>` tag. Useful for bindings. */\\n\\texport let element = undefined;\\n\\n\\t/* --------------------------------------------\\n\\t * Parameters\\n\\t * Values that computed properties are based on and that\\n\\t * can be easily extended from config values\\n\\t *\\n\\t */\\n\\n\\t/** @type {String|Function|Number|Array} x The x accessor. The key in each row of data that corresponds to the x-field. This can be a string, an accessor function, a number or an array of any combination of those types. This property gets converted to a function when you access it through the context. */\\n\\texport let x = undefined;\\n\\t/** @type {String|Function|Number|Array} y The y accessor. The key in each row of data that corresponds to the y-field. This can be a string, an accessor function, a number or an array of any combination of those types. This property gets converted to a function when you access it through the context. */\\n\\texport let y = undefined;\\n\\t/** @type {String|Function|Number|Array} z The z accessor. The key in each row of data that corresponds to the z-field. This can be a string, an accessor function, a number or an array of any combination of those types. This property gets converted to a function when you access it through the context. */\\n\\texport let z = undefined;\\n\\t/** @type {String|Function|Number|Array} r The r accessor. The key in each row of data that corresponds to the r-field. This can be a string, an accessor function, a number or an array of any combination of those types. This property gets converted to a function when you access it through the context. */\\n\\texport let r = undefined;\\n\\n\\t/** @type {Array|Object} [data=[]] If `data` is not a flat array of objects and you want to use any of the scales, set a flat version of the data via the `flatData` prop. */\\n\\texport let data = [];\\n\\n\\t/** @type {[min: Number|null, max: Number|null]|String[]|Number[]|Function} [xDomain] Set a min or max. For linear scales, if you want to inherit the value from the data's extent, set that value to `null`. This value can also be an array because sometimes your scales are [piecewise](https://github.com/d3/d3-scale#continuous_domain) or are a list of discrete values such as in [ordinal scales](https://github.com/d3/d3-scale#ordinal-scales), useful for color series. Set it to a function that receives the computed domain and lets you return a modified domain, useful for sorting values. */\\n\\texport let xDomain = undefined;\\n\\t/** @type {[min: Number|null, max: Number|null]|String[]|Number[]|Function} [yDomain] Set a min or max. For linear scales, if you want to inherit the value from the data's extent, set that value to `null`.  Set it to a function that receives the computed domain and lets you return a modified domain, useful for sorting values. */\\n\\texport let yDomain = undefined;\\n\\t/** @type {[min: Number|null, max: Number|null]|String[]|Number[]|Function} [zDomain] Set a min or max. For linear scales, if you want to inherit the value from the data's extent, set that value to `null`. This value can also be an array because sometimes your scales are [piecewise](https://github.com/d3/d3-scale#continuous_domain) or are a list of discrete values such as in [ordinal scales](https://github.com/d3/d3-scale#ordinal-scales), useful for color series. Set it to a function that receives the computed domain and lets you return a modified domain, useful for sorting values. */\\n\\texport let zDomain = undefined;\\n\\t/** @type {[min: Number|null, max: Number|null]|String[]|Number[]|Function} [rDomain] Set a min or max. For linear scales, if you want to inherit the value from the data's extent, set that value to `null`. This value can also be an array because sometimes your scales are [piecewise](https://github.com/d3/d3-scale#continuous_domain) or are a list of discrete values such as in [ordinal scales](https://github.com/d3/d3-scale#ordinal-scales), useful for color series. Set it to a function that receives the computed domain and lets you return a modified domain, useful for sorting values. */\\n\\texport let rDomain = undefined;\\n\\t/** @type {Boolean|Number} [xNice=false] Applies D3's [scale.nice()](https://github.com/d3/d3-scale#continuous_nice) to the x domain. */\\n\\texport let xNice = false;\\n\\t/** @type {Boolean|Number} [yNice=false] Applies D3's [scale.nice()](https://github.com/d3/d3-scale#continuous_nice) to the y domain. */\\n\\texport let yNice = false;\\n\\t/** @type {Boolean|Number} [zNice=false] Applies D3's [scale.nice()](https://github.com/d3/d3-scale#continuous_nice) to the z domain. */\\n\\texport let zNice = false;\\n\\t/** @type {Boolean} [rNice=false] Applies D3's [scale.nice()](https://github.com/d3/d3-scale#continuous_nice) to the r domain. */\\n\\texport let rNice = false;\\n\\t/** @type {[leftPixels: Number, rightPixels: Number]} [xPadding] Assign a pixel value to add to the min or max of the scale. This will increase the scales domain by the scale unit equivalent of the provided pixels. */\\n\\texport let xPadding = undefined;\\n\\t/** @type {[leftPixels: Number, rightPixels: Number]} [yPadding] Assign a pixel value to add to the min or max of the scale. This will increase the scales domain by the scale unit equivalent of the provided pixels. */\\n\\texport let yPadding = undefined;\\n\\t/** @type {[leftPixels: Number, rightPixels: Number]} [zPadding] Assign a pixel value to add to the min or max of the scale. This will increase the scales domain by the scale unit equivalent of the provided pixels. */\\n\\texport let zPadding = undefined;\\n\\t/** @type {[leftPixels: Number, rightPixels: Number]} [rPadding] Assign a pixel value to add to the min or max of the scale. This will increase the scales domain by the scale unit equivalent of the provided pixels. */\\n\\texport let rPadding = undefined;\\n\\t/** @type {Function} [xScale=d3.scaleLinear] The D3 scale that should be used for the x-dimension. Pass in an instantiated D3 scale if you want to override the default or you want to extra options. */\\n\\texport let xScale = defaultScales.x;\\n\\t/** @type {Function} [yScale=d3.scaleLinear] The D3 scale that should be used for the x-dimension. Pass in an instantiated D3 scale if you want to override the default or you want to extra options. */\\n\\texport let yScale = defaultScales.y;\\n\\t/** @type {Function} [zScale=d3.scaleLinear] The D3 scale that should be used for the x-dimension. Pass in an instantiated D3 scale if you want to override the default or you want to extra options. */\\n\\texport let zScale = defaultScales.z;\\n\\t/** @type {Function} [rScale=d3.scaleSqrt] The D3 scale that should be used for the x-dimension. Pass in an instantiated D3 scale if you want to override the default or you want to extra options. */\\n\\texport let rScale = defaultScales.r;\\n\\t/** @type {[min: Number, max: Number]|Function|String[]|Number[]} [xRange] Override the default x range of `[0, width]` by setting an array or function with argument `({ width, height})` that returns an array. Setting this prop overrides `xReverse`. This can also be a list of numbers or strings for scales with discrete ranges like [scaleThreshhold](https://github.com/d3/d3-scale#threshold-scales) or [scaleQuantize](https://github.com/d3/d3-scale#quantize-scales). */\\n\\texport let xRange = undefined;\\n\\t/** @type {[min: Number, max: Number]|Function|String[]|Number[]} [xRange] Override the default y range of `[0, height]` by setting an array or function with argument `({ width, height})` that returns an array. Setting this prop overrides `yReverse`. This can also be a list of numbers or strings for scales with discrete ranges like [scaleThreshhold](https://github.com/d3/d3-scale#threshold-scales) or [scaleQuantize](https://github.com/d3/d3-scale#quantize-scales). */\\n\\texport let yRange = undefined;\\n\\t/** @type {[min: Number, max: Number]|Function|String[]|Number[]} [zRange] Override the default z range of `[0, width]` by setting an array or function with argument `({ width, height})` that returns an array. Setting this prop overrides `zReverse`. This can also be a list of numbers or strings for scales with discrete ranges like [scaleThreshhold](https://github.com/d3/d3-scale#threshold-scales) or [scaleQuantize](https://github.com/d3/d3-scale#quantize-scales). */\\n\\texport let zRange = undefined;\\n\\t/** @type {[min: Number, max: Number]|Function|String[]|Number[]} [rRange] Override the default r range of `[1, 25]` by setting an array or function with argument `({ width, height})` that returns an array. Setting this prop overrides `rReverse`. This can also be a list of numbers or strings for scales with discrete ranges like [scaleThreshhold](https://github.com/d3/d3-scale#threshold-scales) or [scaleQuantize](https://github.com/d3/d3-scale#quantize-scales). */\\n\\texport let rRange = undefined;\\n\\t/** @type {Boolean} [xReverse=false] Reverse the default x range. By default this is `false` and the range is `[0, width]`. Ignored if you set the xRange prop. */\\n\\texport let xReverse = false;\\n\\t/** @type {Boolean} [yReverse=true] Reverse the default y range. By default this is `true` and the range is `[height, 0]` unless using an ordinal scale with a `.bandwidth` method for `yScale`. Ignored if you set the `yRange` prop. */\\n\\texport let yReverse = undefined\\n\\t/** @type {Boolean} [zReverse=false] Reverse the default z range. By default this is `false` and the range is `[0, width]`. Ignored if you set the zRange prop. */\\n\\texport let zReverse = false;\\n\\t/** @type {Boolean} [rReverse=false] Reverse the default r range. By default this is `false` and the range is `[1, 25]`. Ignored if you set the rRange prop. */\\n\\texport let rReverse = false;\\n\\t/** @type {{top?: Number, right?: Number, bottom?: Number, left?: Number}} [padding={}] The amount of padding to put around your chart. It operates like CSS box-sizing: border-box; where values are subtracted from the parent container's width and height, the same as a [D3 margin convention](https://bl.ocks.org/mbostock/3019563). */\\n\\texport let padding = {};\\n\\t/** @type {{ x?: [min: Number, max: Number], y?: [min: Number, max: Number], r?: [min: Number, max: Number], z?: [min: Number, max: Number] }} [extents] Manually set the extents of the x, y or r scale as a two-dimensional array of the min and max you want. Setting values here will skip any dynamic extent calculation of the data for that dimension. */\\n\\texport let extents = {};\\n\\n\\t/** @type {Array} [flatData=data] A flat version of data. */\\n\\texport let flatData = undefined;\\n\\n\\t/** @type {Object} custom Any extra configuration values you want available on the LayerCake context. This could be useful for color lookups or additional constants. */\\n\\texport let custom = {};\\n\\n\\t/** @type {Boolean} debug Enable debug printing to the console. Useful to inspect your scales and dimensions. */\\n\\texport let debug = false;\\n\\n\\t/**\\n\\t * Make this reactive\\n\\t */\\n\\t$: yReverseValue = typeof yReverse === 'undefined'\\n\\t\\t? typeof yScale.bandwidth === 'function' ? false : true\\n\\t\\t: yReverse;\\n\\n\\t/* --------------------------------------------\\n\\t * Keep track of whether the component has mounted\\n\\t * This is used to emit warnings once we have measured\\n\\t * the container object and it doesn't have proper dimensions\\n\\t */\\n\\tlet isMounted = false;\\n\\tonMount(() => {\\n\\t\\tisMounted = true;\\n\\t});\\n\\n\\t/* --------------------------------------------\\n\\t * Preserve a copy of our passed in settings before we modify them\\n\\t * Return this to the user's context so they can reference things if need be\\n\\t * Add the active keys since those aren't on our settings object.\\n\\t * This is mostly an escape-hatch\\n\\t */\\n\\tconst config = {};\\n\\t$: if (x) config.x = x;\\n\\t$: if (y) config.y = y;\\n\\t$: if (z) config.z = z;\\n\\t$: if (r) config.r = r;\\n\\t$: if (xDomain) config.xDomain = xDomain;\\n\\t$: if (yDomain) config.yDomain = yDomain;\\n\\t$: if (zDomain) config.zDomain = zDomain;\\n\\t$: if (rDomain) config.rDomain = rDomain;\\n\\t$: if (xRange) config.xRange = xRange;\\n\\t$: if (yRange) config.yRange = yRange;\\n\\t$: if (zRange) config.zRange = zRange;\\n\\t$: if (rRange) config.rRange = rRange;\\n\\n\\t/* --------------------------------------------\\n\\t * Make store versions of each parameter\\n\\t * Prefix these with `_` to keep things organized\\n\\t */\\n\\tconst _percentRange = writable(percentRange);\\n\\tconst _containerWidth = writable(containerWidth);\\n\\tconst _containerHeight = writable(containerHeight);\\n\\tconst _extents = writable(filterObject(extents));\\n\\tconst _data = writable(data);\\n\\tconst _flatData = writable(flatData || data);\\n\\tconst _padding = writable(padding);\\n\\tconst _x = writable(makeAccessor(x));\\n\\tconst _y = writable(makeAccessor(y));\\n\\tconst _z = writable(makeAccessor(z));\\n\\tconst _r = writable(makeAccessor(r));\\n\\tconst _xDomain = writable(xDomain);\\n\\tconst _yDomain = writable(yDomain);\\n\\tconst _zDomain = writable(zDomain);\\n\\tconst _rDomain = writable(rDomain);\\n\\tconst _xNice = writable(xNice);\\n\\tconst _yNice = writable(yNice);\\n\\tconst _zNice = writable(zNice);\\n\\tconst _rNice = writable(rNice);\\n\\tconst _xReverse = writable(xReverse);\\n\\tconst _yReverse = writable(yReverseValue);\\n\\tconst _zReverse = writable(zReverse);\\n\\tconst _rReverse = writable(rReverse);\\n\\tconst _xPadding = writable(xPadding);\\n\\tconst _yPadding = writable(yPadding);\\n\\tconst _zPadding = writable(zPadding);\\n\\tconst _rPadding = writable(rPadding);\\n\\tconst _xRange = writable(xRange);\\n\\tconst _yRange = writable(yRange);\\n\\tconst _zRange = writable(zRange);\\n\\tconst _rRange = writable(rRange);\\n\\tconst _xScale = writable(xScale);\\n\\tconst _yScale = writable(yScale);\\n\\tconst _zScale = writable(zScale);\\n\\tconst _rScale = writable(rScale);\\n\\tconst _config = writable(config);\\n\\tconst _custom = writable(custom);\\n\\n\\t$: $_percentRange = percentRange;\\n\\t$: $_containerWidth = containerWidth;\\n\\t$: $_containerHeight = containerHeight;\\n\\t$: $_extents = filterObject(extents);\\n\\t$: $_data = data;\\n\\t$: $_flatData = flatData || data;\\n\\t$: $_padding = padding;\\n\\t$: $_x = makeAccessor(x);\\n\\t$: $_y = makeAccessor(y);\\n\\t$: $_z = makeAccessor(z);\\n\\t$: $_r = makeAccessor(r);\\n\\t$: $_xDomain = xDomain;\\n\\t$: $_yDomain = yDomain;\\n\\t$: $_zDomain = zDomain;\\n\\t$: $_rDomain = rDomain;\\n\\t$: $_xNice = xNice;\\n\\t$: $_yNice = yNice;\\n\\t$: $_zNice = zNice;\\n\\t$: $_rNice = rNice;\\n\\t$: $_xReverse = xReverse;\\n\\t$: $_yReverse = yReverseValue;\\n\\t$: $_zReverse = zReverse;\\n\\t$: $_rReverse = rReverse;\\n\\t$: $_xPadding = xPadding;\\n\\t$: $_yPadding = yPadding;\\n\\t$: $_zPadding = zPadding;\\n\\t$: $_rPadding = rPadding;\\n\\t$: $_xRange = xRange;\\n\\t$: $_yRange = yRange;\\n\\t$: $_zRange = zRange;\\n\\t$: $_rRange = rRange;\\n\\t$: $_xScale = xScale;\\n\\t$: $_yScale = yScale;\\n\\t$: $_zScale = zScale;\\n\\t$: $_rScale = rScale;\\n\\t$: $_custom = custom;\\n\\t$: $_config = config;\\n\\n\\t/* --------------------------------------------\\n\\t * Create derived values\\n\\t * Suffix these with `_d`\\n\\t */\\n\\tconst activeGetters_d = derived([_x, _y, _z, _r], ([$x, $y, $z, $r]) => {\\n\\t\\tconst obj = {};\\n\\t\\tif ($x) {\\n\\t\\t\\tobj.x = $x;\\n\\t\\t}\\n\\t\\tif ($y) {\\n\\t\\t\\tobj.y = $y;\\n\\t\\t}\\n\\t\\tif ($z) {\\n\\t\\t\\tobj.z = $z;\\n\\t\\t}\\n\\t\\tif ($r) {\\n\\t\\t\\tobj.r = $r;\\n\\t\\t}\\n\\t\\treturn obj;\\n\\t});\\n\\n\\tconst padding_d = derived([_padding, _containerWidth, _containerHeight], ([$padding]) => {\\n\\t\\tconst defaultPadding = { top: 0, right: 0, bottom: 0, left: 0 };\\n\\t\\treturn Object.assign(defaultPadding, $padding);\\n\\t});\\n\\n\\tconst box_d = derived(\\n\\t\\t[_containerWidth, _containerHeight, padding_d],\\n\\t\\t([$containerWidth, $containerHeight, $padding]) => {\\n\\t\\t\\tconst b = {};\\n\\t\\t\\tb.top = $padding.top;\\n\\t\\t\\tb.right = $containerWidth - $padding.right;\\n\\t\\t\\tb.bottom = $containerHeight - $padding.bottom;\\n\\t\\t\\tb.left = $padding.left;\\n\\t\\t\\tb.width = b.right - b.left;\\n\\t\\t\\tb.height = b.bottom - b.top;\\n\\t\\t\\tif (b.width <= 0 && isMounted === true) {\\n\\t\\t\\t\\tconsole.warn(\\n\\t\\t\\t\\t\\t'[LayerCake] Target div has zero or negative width. Did you forget to set an explicit width in CSS on the container?'\\n\\t\\t\\t\\t);\\n\\t\\t\\t}\\n\\t\\t\\tif (b.height <= 0 && isMounted === true) {\\n\\t\\t\\t\\tconsole.warn(\\n\\t\\t\\t\\t\\t'[LayerCake] Target div has zero or negative height. Did you forget to set an explicit height in CSS on the container?'\\n\\t\\t\\t\\t);\\n\\t\\t\\t}\\n\\t\\t\\treturn b;\\n\\t\\t}\\n\\t);\\n\\n\\tconst width_d = derived([box_d], ([$box]) => {\\n\\t\\treturn $box.width;\\n\\t});\\n\\n\\tconst height_d = derived([box_d], ([$box]) => {\\n\\t\\treturn $box.height;\\n\\t});\\n\\n\\t/* --------------------------------------------\\n\\t * Calculate extents by taking the extent of the data\\n\\t * and filling that in with anything set by the user\\n\\t * Note that this is different from an \\\"extent\\\" passed\\n\\t * in as a domain, which can be a partial domain\\n\\t */\\n\\tconst extents_d = derived(\\n\\t\\t[_flatData, activeGetters_d, _extents, _xScale, _yScale, _rScale, _zScale],\\n\\t\\t([$flatData, $activeGetters, $extents, $_xScale, $_yScale, $_rScale, $_zScale]) => {\\n\\t\\t\\tconst scaleLookup = { x: $_xScale, y: $_yScale, r: $_rScale, z: $_zScale };\\n\\t\\t\\tconst getters = filterObject($activeGetters, $extents);\\n\\t\\t\\tconst activeScales = Object.fromEntries(Object.keys(getters).map((k) => [k, scaleLookup[k]]));\\n\\n\\t\\t\\tif (Object.keys(getters).length > 0) {\\n\\t\\t\\t\\tconst calculatedExtents = calcScaleExtents($flatData, getters, activeScales);\\n\\t\\t\\t\\treturn { ...calculatedExtents, ...$extents };\\n\\t\\t\\t} else {\\n\\t\\t\\t\\treturn {};\\n\\t\\t\\t}\\n\\t\\t}\\n\\t);\\n\\n\\tconst xDomain_d = derived([extents_d, _xDomain], calcDomain('x'));\\n\\tconst yDomain_d = derived([extents_d, _yDomain], calcDomain('y'));\\n\\tconst zDomain_d = derived([extents_d, _zDomain], calcDomain('z'));\\n\\tconst rDomain_d = derived([extents_d, _rDomain], calcDomain('r'));\\n\\n\\tconst xScale_d = derived(\\n\\t\\t[\\n\\t\\t\\t_xScale,\\n\\t\\t\\textents_d,\\n\\t\\t\\txDomain_d,\\n\\t\\t\\t_xPadding,\\n\\t\\t\\t_xNice,\\n\\t\\t\\t_xReverse,\\n\\t\\t\\twidth_d,\\n\\t\\t\\theight_d,\\n\\t\\t\\t_xRange,\\n\\t\\t\\t_percentRange\\n\\t\\t],\\n\\t\\tcreateScale('x')\\n\\t);\\n\\tconst xGet_d = derived([_x, xScale_d], createGetter);\\n\\n\\tconst yScale_d = derived(\\n\\t\\t[\\n\\t\\t\\t_yScale,\\n\\t\\t\\textents_d,\\n\\t\\t\\tyDomain_d,\\n\\t\\t\\t_yPadding,\\n\\t\\t\\t_yNice,\\n\\t\\t\\t_yReverse,\\n\\t\\t\\twidth_d,\\n\\t\\t\\theight_d,\\n\\t\\t\\t_yRange,\\n\\t\\t\\t_percentRange\\n\\t\\t],\\n\\t\\tcreateScale('y')\\n\\t);\\n\\tconst yGet_d = derived([_y, yScale_d], createGetter);\\n\\n\\tconst zScale_d = derived(\\n\\t\\t[\\n\\t\\t\\t_zScale,\\n\\t\\t\\textents_d,\\n\\t\\t\\tzDomain_d,\\n\\t\\t\\t_zPadding,\\n\\t\\t\\t_zNice,\\n\\t\\t\\t_zReverse,\\n\\t\\t\\twidth_d,\\n\\t\\t\\theight_d,\\n\\t\\t\\t_zRange,\\n\\t\\t\\t_percentRange\\n\\t\\t],\\n\\t\\tcreateScale('z')\\n\\t);\\n\\tconst zGet_d = derived([_z, zScale_d], createGetter);\\n\\n\\tconst rScale_d = derived(\\n\\t\\t[\\n\\t\\t\\t_rScale,\\n\\t\\t\\textents_d,\\n\\t\\t\\trDomain_d,\\n\\t\\t\\t_rPadding,\\n\\t\\t\\t_rNice,\\n\\t\\t\\t_rReverse,\\n\\t\\t\\twidth_d,\\n\\t\\t\\theight_d,\\n\\t\\t\\t_rRange,\\n\\t\\t\\t_percentRange\\n\\t\\t],\\n\\t\\tcreateScale('r')\\n\\t);\\n\\tconst rGet_d = derived([_r, rScale_d], createGetter);\\n\\n\\tconst xRange_d = derived([xScale_d], getRange);\\n\\tconst yRange_d = derived([yScale_d], getRange);\\n\\tconst zRange_d = derived([zScale_d], getRange);\\n\\tconst rRange_d = derived([rScale_d], getRange);\\n\\n\\tconst aspectRatio_d = derived([width_d, height_d], ([$width, $height]) => {\\n\\t\\treturn $width / $height;\\n\\t});\\n\\n\\t$: context = {\\n\\t\\tactiveGetters: activeGetters_d,\\n\\t\\twidth: width_d,\\n\\t\\theight: height_d,\\n\\t\\tpercentRange: _percentRange,\\n\\t\\taspectRatio: aspectRatio_d,\\n\\t\\tcontainerWidth: _containerWidth,\\n\\t\\tcontainerHeight: _containerHeight,\\n\\t\\tx: _x,\\n\\t\\ty: _y,\\n\\t\\tz: _z,\\n\\t\\tr: _r,\\n\\t\\tcustom: _custom,\\n\\t\\tdata: _data,\\n\\t\\txNice: _xNice,\\n\\t\\tyNice: _yNice,\\n\\t\\tzNice: _zNice,\\n\\t\\trNice: _rNice,\\n\\t\\txReverse: _xReverse,\\n\\t\\tyReverse: _yReverse,\\n\\t\\tzReverse: _zReverse,\\n\\t\\trReverse: _rReverse,\\n\\t\\txPadding: _xPadding,\\n\\t\\tyPadding: _yPadding,\\n\\t\\tzPadding: _zPadding,\\n\\t\\trPadding: _rPadding,\\n\\t\\tpadding: padding_d,\\n\\t\\tflatData: _flatData,\\n\\t\\textents: extents_d,\\n\\t\\txDomain: xDomain_d,\\n\\t\\tyDomain: yDomain_d,\\n\\t\\tzDomain: zDomain_d,\\n\\t\\trDomain: rDomain_d,\\n\\t\\txRange: xRange_d,\\n\\t\\tyRange: yRange_d,\\n\\t\\tzRange: zRange_d,\\n\\t\\trRange: rRange_d,\\n\\t\\tconfig: _config,\\n\\t\\txScale: xScale_d,\\n\\t\\txGet: xGet_d,\\n\\t\\tyScale: yScale_d,\\n\\t\\tyGet: yGet_d,\\n\\t\\tzScale: zScale_d,\\n\\t\\tzGet: zGet_d,\\n\\t\\trScale: rScale_d,\\n\\t\\trGet: rGet_d\\n\\t};\\n\\n\\t$: setContext('LayerCake', context);\\n\\n\\t$: if ($box_d && debug === true && (ssr === true || typeof window !== 'undefined')) {\\n\\t\\t// Call this as a debounce so that it doesn't get called multiple times as these vars get filled in\\n\\t\\tprintDebug_debounced({\\n\\t\\t\\tboundingBox: $box_d,\\n\\t\\t\\tactiveGetters: $activeGetters_d,\\n\\t\\t\\tx: config.x,\\n\\t\\t\\ty: config.y,\\n\\t\\t\\tz: config.z,\\n\\t\\t\\tr: config.r,\\n\\t\\t\\txScale: $xScale_d,\\n\\t\\t\\tyScale: $yScale_d,\\n\\t\\t\\tzScale: $zScale_d,\\n\\t\\t\\trScale: $rScale_d,\\n\\t\\t});\\n\\t}\\n</script>\\n\\n{#if ssr === true || typeof window !== 'undefined'}\\n\\t<div\\n\\t\\tbind:this={element}\\n\\t\\tclass=\\\"layercake-container\\\"\\n\\t\\tstyle:position\\n\\t\\tstyle:top={position === 'absolute' ? '0' : null}\\n\\t\\tstyle:right={position === 'absolute' ? '0' : null}\\n\\t\\tstyle:bottom={position === 'absolute' ? '0' : null}\\n\\t\\tstyle:left={position === 'absolute' ? '0' : null}\\n\\t\\tstyle:pointer-events={pointerEvents === false ? 'none' : null}\\n\\t\\tbind:clientWidth={containerWidth}\\n\\t\\tbind:clientHeight={containerHeight}\\n\\t>\\n\\t\\t<slot\\n\\t\\t\\t{element}\\n\\t\\t\\twidth={$width_d}\\n\\t\\t\\theight={$height_d}\\n\\t\\t\\taspectRatio={$aspectRatio_d}\\n\\t\\t\\tcontainerWidth={$_containerWidth}\\n\\t\\t\\tcontainerHeight={$_containerHeight}\\n\\t\\t\\tactiveGetters={$activeGetters_d}\\n\\t\\t\\tpercentRange={$_percentRange}\\n\\t\\t\\tx={$_x}\\n\\t\\t\\ty={$_y}\\n\\t\\t\\tz={$_z}\\n\\t\\t\\tr={$_r}\\n\\t\\t\\tcustom={$_custom}\\n\\t\\t\\tdata={$_data}\\n\\t\\t\\txNice={$_xNice}\\n\\t\\t\\tyNice={$_yNice}\\n\\t\\t\\tzNice={$_zNice}\\n\\t\\t\\trNice={$_rNice}\\n\\t\\t\\txReverse={$_xReverse}\\n\\t\\t\\tyReverse={$_yReverse}\\n\\t\\t\\tzReverse={$_zReverse}\\n\\t\\t\\trReverse={$_rReverse}\\n\\t\\t\\txPadding={$_xPadding}\\n\\t\\t\\tyPadding={$_yPadding}\\n\\t\\t\\tzPadding={$_zPadding}\\n\\t\\t\\trPadding={$_rPadding}\\n\\t\\t\\tpadding={$padding_d}\\n\\t\\t\\tflatData={$_flatData}\\n\\t\\t\\textents={$extents_d}\\n\\t\\t\\txDomain={$xDomain_d}\\n\\t\\t\\tyDomain={$yDomain_d}\\n\\t\\t\\tzDomain={$zDomain_d}\\n\\t\\t\\trDomain={$rDomain_d}\\n\\t\\t\\txRange={$xRange_d}\\n\\t\\t\\tyRange={$yRange_d}\\n\\t\\t\\tzRange={$zRange_d}\\n\\t\\t\\trRange={$rRange_d}\\n\\t\\t\\tconfig={$_config}\\n\\t\\t\\txScale={$xScale_d}\\n\\t\\t\\txGet={$xGet_d}\\n\\t\\t\\tyScale={$yScale_d}\\n\\t\\t\\tyGet={$yGet_d}\\n\\t\\t\\tzScale={$zScale_d}\\n\\t\\t\\tzGet={$zGet_d}\\n\\t\\t\\trScale={$rScale_d}\\n\\t\\t\\trGet={$rGet_d}\\n\\t\\t/>\\n\\t</div>\\n{/if}\\n\\n<style>\\n\\t.layercake-container,\\n\\t.layercake-container :global(*) {\\n\\t\\tbox-sizing: border-box;\\n\\t}\\n\\t.layercake-container {\\n\\t\\twidth: 100%;\\n\\t\\theight: 100%;\\n\\t}\\n</style>\\n\"],\"names\":[],\"mappings\":\"AAqhBC,kCAAoB,CACpB,kCAAoB,CAAS,CAAG,CAC/B,UAAU,CAAE,UACb,CACA,kCAAqB,CACpB,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,IACT\"}"
};

const LayerCake = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let yReverseValue;
	let context;
	let $rScale_d, $$unsubscribe_rScale_d;
	let $zScale_d, $$unsubscribe_zScale_d;
	let $yScale_d, $$unsubscribe_yScale_d;
	let $xScale_d, $$unsubscribe_xScale_d;
	let $activeGetters_d, $$unsubscribe_activeGetters_d;
	let $box_d, $$unsubscribe_box_d;
	let $_config, $$unsubscribe__config;
	let $_custom, $$unsubscribe__custom;
	let $_rScale, $$unsubscribe__rScale;
	let $_zScale, $$unsubscribe__zScale;
	let $_yScale, $$unsubscribe__yScale;
	let $_xScale, $$unsubscribe__xScale;
	let $_rRange, $$unsubscribe__rRange;
	let $_zRange, $$unsubscribe__zRange;
	let $_yRange, $$unsubscribe__yRange;
	let $_xRange, $$unsubscribe__xRange;
	let $_rPadding, $$unsubscribe__rPadding;
	let $_zPadding, $$unsubscribe__zPadding;
	let $_yPadding, $$unsubscribe__yPadding;
	let $_xPadding, $$unsubscribe__xPadding;
	let $_rReverse, $$unsubscribe__rReverse;
	let $_zReverse, $$unsubscribe__zReverse;
	let $_yReverse, $$unsubscribe__yReverse;
	let $_xReverse, $$unsubscribe__xReverse;
	let $_rNice, $$unsubscribe__rNice;
	let $_zNice, $$unsubscribe__zNice;
	let $_yNice, $$unsubscribe__yNice;
	let $_xNice, $$unsubscribe__xNice;
	let $_rDomain, $$unsubscribe__rDomain;
	let $_zDomain, $$unsubscribe__zDomain;
	let $_yDomain, $$unsubscribe__yDomain;
	let $_xDomain, $$unsubscribe__xDomain;
	let $_r, $$unsubscribe__r;
	let $_z, $$unsubscribe__z;
	let $_y, $$unsubscribe__y;
	let $_x, $$unsubscribe__x;
	let $_padding, $$unsubscribe__padding;
	let $_flatData, $$unsubscribe__flatData;
	let $_data, $$unsubscribe__data;
	let $_extents, $$unsubscribe__extents;
	let $_containerHeight, $$unsubscribe__containerHeight;
	let $_containerWidth, $$unsubscribe__containerWidth;
	let $_percentRange, $$unsubscribe__percentRange;
	let $width_d, $$unsubscribe_width_d;
	let $height_d, $$unsubscribe_height_d;
	let $aspectRatio_d, $$unsubscribe_aspectRatio_d;
	let $padding_d, $$unsubscribe_padding_d;
	let $extents_d, $$unsubscribe_extents_d;
	let $xDomain_d, $$unsubscribe_xDomain_d;
	let $yDomain_d, $$unsubscribe_yDomain_d;
	let $zDomain_d, $$unsubscribe_zDomain_d;
	let $rDomain_d, $$unsubscribe_rDomain_d;
	let $xRange_d, $$unsubscribe_xRange_d;
	let $yRange_d, $$unsubscribe_yRange_d;
	let $zRange_d, $$unsubscribe_zRange_d;
	let $rRange_d, $$unsubscribe_rRange_d;
	let $xGet_d, $$unsubscribe_xGet_d;
	let $yGet_d, $$unsubscribe_yGet_d;
	let $zGet_d, $$unsubscribe_zGet_d;
	let $rGet_d, $$unsubscribe_rGet_d;
	const printDebug_debounced = debounce(printDebug, 200);
	let { ssr = false } = $$props;
	let { pointerEvents = true } = $$props;
	let { position = 'relative' } = $$props;
	let { percentRange = false } = $$props;
	let { width = undefined } = $$props;
	let { height = undefined } = $$props;
	let { containerWidth = width || 100 } = $$props;
	let { containerHeight = height || 100 } = $$props;
	let { element = undefined } = $$props;
	let { x = undefined } = $$props;
	let { y = undefined } = $$props;
	let { z = undefined } = $$props;
	let { r = undefined } = $$props;
	let { data = [] } = $$props;
	let { xDomain = undefined } = $$props;
	let { yDomain = undefined } = $$props;
	let { zDomain = undefined } = $$props;
	let { rDomain = undefined } = $$props;
	let { xNice = false } = $$props;
	let { yNice = false } = $$props;
	let { zNice = false } = $$props;
	let { rNice = false } = $$props;
	let { xPadding = undefined } = $$props;
	let { yPadding = undefined } = $$props;
	let { zPadding = undefined } = $$props;
	let { rPadding = undefined } = $$props;
	let { xScale = defaultScales.x } = $$props;
	let { yScale = defaultScales.y } = $$props;
	let { zScale = defaultScales.z } = $$props;
	let { rScale = defaultScales.r } = $$props;
	let { xRange = undefined } = $$props;
	let { yRange = undefined } = $$props;
	let { zRange = undefined } = $$props;
	let { rRange = undefined } = $$props;
	let { xReverse = false } = $$props;
	let { yReverse = undefined } = $$props;
	let { zReverse = false } = $$props;
	let { rReverse = false } = $$props;
	let { padding = {} } = $$props;
	let { extents = {} } = $$props;
	let { flatData = undefined } = $$props;
	let { custom = {} } = $$props;
	let { debug = false } = $$props;

	/* --------------------------------------------
 * Keep track of whether the component has mounted
 * This is used to emit warnings once we have measured
 * the container object and it doesn't have proper dimensions
 */
	let isMounted = false;

	/* --------------------------------------------
 * Preserve a copy of our passed in settings before we modify them
 * Return this to the user's context so they can reference things if need be
 * Add the active keys since those aren't on our settings object.
 * This is mostly an escape-hatch
 */
	const config = {};

	/* --------------------------------------------
 * Make store versions of each parameter
 * Prefix these with `_` to keep things organized
 */
	const _percentRange = writable(percentRange);

	$$unsubscribe__percentRange = subscribe(_percentRange, value => $_percentRange = value);
	const _containerWidth = writable(containerWidth);
	$$unsubscribe__containerWidth = subscribe(_containerWidth, value => $_containerWidth = value);
	const _containerHeight = writable(containerHeight);
	$$unsubscribe__containerHeight = subscribe(_containerHeight, value => $_containerHeight = value);
	const _extents = writable(filterObject(extents));
	$$unsubscribe__extents = subscribe(_extents, value => $_extents = value);
	const _data = writable(data);
	$$unsubscribe__data = subscribe(_data, value => $_data = value);
	const _flatData = writable(flatData || data);
	$$unsubscribe__flatData = subscribe(_flatData, value => $_flatData = value);
	const _padding = writable(padding);
	$$unsubscribe__padding = subscribe(_padding, value => $_padding = value);
	const _x = writable(makeAccessor(x));
	$$unsubscribe__x = subscribe(_x, value => $_x = value);
	const _y = writable(makeAccessor(y));
	$$unsubscribe__y = subscribe(_y, value => $_y = value);
	const _z = writable(makeAccessor(z));
	$$unsubscribe__z = subscribe(_z, value => $_z = value);
	const _r = writable(makeAccessor(r));
	$$unsubscribe__r = subscribe(_r, value => $_r = value);
	const _xDomain = writable(xDomain);
	$$unsubscribe__xDomain = subscribe(_xDomain, value => $_xDomain = value);
	const _yDomain = writable(yDomain);
	$$unsubscribe__yDomain = subscribe(_yDomain, value => $_yDomain = value);
	const _zDomain = writable(zDomain);
	$$unsubscribe__zDomain = subscribe(_zDomain, value => $_zDomain = value);
	const _rDomain = writable(rDomain);
	$$unsubscribe__rDomain = subscribe(_rDomain, value => $_rDomain = value);
	const _xNice = writable(xNice);
	$$unsubscribe__xNice = subscribe(_xNice, value => $_xNice = value);
	const _yNice = writable(yNice);
	$$unsubscribe__yNice = subscribe(_yNice, value => $_yNice = value);
	const _zNice = writable(zNice);
	$$unsubscribe__zNice = subscribe(_zNice, value => $_zNice = value);
	const _rNice = writable(rNice);
	$$unsubscribe__rNice = subscribe(_rNice, value => $_rNice = value);
	const _xReverse = writable(xReverse);
	$$unsubscribe__xReverse = subscribe(_xReverse, value => $_xReverse = value);
	const _yReverse = writable(yReverseValue);
	$$unsubscribe__yReverse = subscribe(_yReverse, value => $_yReverse = value);
	const _zReverse = writable(zReverse);
	$$unsubscribe__zReverse = subscribe(_zReverse, value => $_zReverse = value);
	const _rReverse = writable(rReverse);
	$$unsubscribe__rReverse = subscribe(_rReverse, value => $_rReverse = value);
	const _xPadding = writable(xPadding);
	$$unsubscribe__xPadding = subscribe(_xPadding, value => $_xPadding = value);
	const _yPadding = writable(yPadding);
	$$unsubscribe__yPadding = subscribe(_yPadding, value => $_yPadding = value);
	const _zPadding = writable(zPadding);
	$$unsubscribe__zPadding = subscribe(_zPadding, value => $_zPadding = value);
	const _rPadding = writable(rPadding);
	$$unsubscribe__rPadding = subscribe(_rPadding, value => $_rPadding = value);
	const _xRange = writable(xRange);
	$$unsubscribe__xRange = subscribe(_xRange, value => $_xRange = value);
	const _yRange = writable(yRange);
	$$unsubscribe__yRange = subscribe(_yRange, value => $_yRange = value);
	const _zRange = writable(zRange);
	$$unsubscribe__zRange = subscribe(_zRange, value => $_zRange = value);
	const _rRange = writable(rRange);
	$$unsubscribe__rRange = subscribe(_rRange, value => $_rRange = value);
	const _xScale = writable(xScale);
	$$unsubscribe__xScale = subscribe(_xScale, value => $_xScale = value);
	const _yScale = writable(yScale);
	$$unsubscribe__yScale = subscribe(_yScale, value => $_yScale = value);
	const _zScale = writable(zScale);
	$$unsubscribe__zScale = subscribe(_zScale, value => $_zScale = value);
	const _rScale = writable(rScale);
	$$unsubscribe__rScale = subscribe(_rScale, value => $_rScale = value);
	const _config = writable(config);
	$$unsubscribe__config = subscribe(_config, value => $_config = value);
	const _custom = writable(custom);
	$$unsubscribe__custom = subscribe(_custom, value => $_custom = value);

	/* --------------------------------------------
 * Create derived values
 * Suffix these with `_d`
 */
	const activeGetters_d = derived([_x, _y, _z, _r], ([$x, $y, $z, $r]) => {
		const obj = {};

		if ($x) {
			obj.x = $x;
		}

		if ($y) {
			obj.y = $y;
		}

		if ($z) {
			obj.z = $z;
		}

		if ($r) {
			obj.r = $r;
		}

		return obj;
	});

	$$unsubscribe_activeGetters_d = subscribe(activeGetters_d, value => $activeGetters_d = value);

	const padding_d = derived([_padding, _containerWidth, _containerHeight], ([$padding]) => {
		const defaultPadding = { top: 0, right: 0, bottom: 0, left: 0 };
		return Object.assign(defaultPadding, $padding);
	});

	$$unsubscribe_padding_d = subscribe(padding_d, value => $padding_d = value);

	const box_d = derived([_containerWidth, _containerHeight, padding_d], ([$containerWidth, $containerHeight, $padding]) => {
		const b = {};
		b.top = $padding.top;
		b.right = $containerWidth - $padding.right;
		b.bottom = $containerHeight - $padding.bottom;
		b.left = $padding.left;
		b.width = b.right - b.left;
		b.height = b.bottom - b.top;

		if (b.width <= 0 && isMounted === true) {
			console.warn('[LayerCake] Target div has zero or negative width. Did you forget to set an explicit width in CSS on the container?');
		}

		if (b.height <= 0 && isMounted === true) {
			console.warn('[LayerCake] Target div has zero or negative height. Did you forget to set an explicit height in CSS on the container?');
		}

		return b;
	});

	$$unsubscribe_box_d = subscribe(box_d, value => $box_d = value);

	const width_d = derived([box_d], ([$box]) => {
		return $box.width;
	});

	$$unsubscribe_width_d = subscribe(width_d, value => $width_d = value);

	const height_d = derived([box_d], ([$box]) => {
		return $box.height;
	});

	$$unsubscribe_height_d = subscribe(height_d, value => $height_d = value);

	/* --------------------------------------------
 * Calculate extents by taking the extent of the data
 * and filling that in with anything set by the user
 * Note that this is different from an "extent" passed
 * in as a domain, which can be a partial domain
 */
	const extents_d = derived([_flatData, activeGetters_d, _extents, _xScale, _yScale, _rScale, _zScale], ([$flatData, $activeGetters, $extents, $_xScale, $_yScale, $_rScale, $_zScale]) => {
		const scaleLookup = {
			x: $_xScale,
			y: $_yScale,
			r: $_rScale,
			z: $_zScale
		};

		const getters = filterObject($activeGetters, $extents);
		const activeScales = Object.fromEntries(Object.keys(getters).map(k => [k, scaleLookup[k]]));

		if (Object.keys(getters).length > 0) {
			const calculatedExtents = calcScaleExtents($flatData, getters, activeScales);
			return { ...calculatedExtents, ...$extents };
		} else {
			return {};
		}
	});

	$$unsubscribe_extents_d = subscribe(extents_d, value => $extents_d = value);
	const xDomain_d = derived([extents_d, _xDomain], calcDomain('x'));
	$$unsubscribe_xDomain_d = subscribe(xDomain_d, value => $xDomain_d = value);
	const yDomain_d = derived([extents_d, _yDomain], calcDomain('y'));
	$$unsubscribe_yDomain_d = subscribe(yDomain_d, value => $yDomain_d = value);
	const zDomain_d = derived([extents_d, _zDomain], calcDomain('z'));
	$$unsubscribe_zDomain_d = subscribe(zDomain_d, value => $zDomain_d = value);
	const rDomain_d = derived([extents_d, _rDomain], calcDomain('r'));
	$$unsubscribe_rDomain_d = subscribe(rDomain_d, value => $rDomain_d = value);

	const xScale_d = derived(
		[
			_xScale,
			extents_d,
			xDomain_d,
			_xPadding,
			_xNice,
			_xReverse,
			width_d,
			height_d,
			_xRange,
			_percentRange
		],
		createScale('x')
	);

	$$unsubscribe_xScale_d = subscribe(xScale_d, value => $xScale_d = value);
	const xGet_d = derived([_x, xScale_d], createGetter);
	$$unsubscribe_xGet_d = subscribe(xGet_d, value => $xGet_d = value);

	const yScale_d = derived(
		[
			_yScale,
			extents_d,
			yDomain_d,
			_yPadding,
			_yNice,
			_yReverse,
			width_d,
			height_d,
			_yRange,
			_percentRange
		],
		createScale('y')
	);

	$$unsubscribe_yScale_d = subscribe(yScale_d, value => $yScale_d = value);
	const yGet_d = derived([_y, yScale_d], createGetter);
	$$unsubscribe_yGet_d = subscribe(yGet_d, value => $yGet_d = value);

	const zScale_d = derived(
		[
			_zScale,
			extents_d,
			zDomain_d,
			_zPadding,
			_zNice,
			_zReverse,
			width_d,
			height_d,
			_zRange,
			_percentRange
		],
		createScale('z')
	);

	$$unsubscribe_zScale_d = subscribe(zScale_d, value => $zScale_d = value);
	const zGet_d = derived([_z, zScale_d], createGetter);
	$$unsubscribe_zGet_d = subscribe(zGet_d, value => $zGet_d = value);

	const rScale_d = derived(
		[
			_rScale,
			extents_d,
			rDomain_d,
			_rPadding,
			_rNice,
			_rReverse,
			width_d,
			height_d,
			_rRange,
			_percentRange
		],
		createScale('r')
	);

	$$unsubscribe_rScale_d = subscribe(rScale_d, value => $rScale_d = value);
	const rGet_d = derived([_r, rScale_d], createGetter);
	$$unsubscribe_rGet_d = subscribe(rGet_d, value => $rGet_d = value);
	const xRange_d = derived([xScale_d], getRange);
	$$unsubscribe_xRange_d = subscribe(xRange_d, value => $xRange_d = value);
	const yRange_d = derived([yScale_d], getRange);
	$$unsubscribe_yRange_d = subscribe(yRange_d, value => $yRange_d = value);
	const zRange_d = derived([zScale_d], getRange);
	$$unsubscribe_zRange_d = subscribe(zRange_d, value => $zRange_d = value);
	const rRange_d = derived([rScale_d], getRange);
	$$unsubscribe_rRange_d = subscribe(rRange_d, value => $rRange_d = value);

	const aspectRatio_d = derived([width_d, height_d], ([$width, $height]) => {
		return $width / $height;
	});

	$$unsubscribe_aspectRatio_d = subscribe(aspectRatio_d, value => $aspectRatio_d = value);
	if ($$props.ssr === void 0 && $$bindings.ssr && ssr !== void 0) $$bindings.ssr(ssr);
	if ($$props.pointerEvents === void 0 && $$bindings.pointerEvents && pointerEvents !== void 0) $$bindings.pointerEvents(pointerEvents);
	if ($$props.position === void 0 && $$bindings.position && position !== void 0) $$bindings.position(position);
	if ($$props.percentRange === void 0 && $$bindings.percentRange && percentRange !== void 0) $$bindings.percentRange(percentRange);
	if ($$props.width === void 0 && $$bindings.width && width !== void 0) $$bindings.width(width);
	if ($$props.height === void 0 && $$bindings.height && height !== void 0) $$bindings.height(height);
	if ($$props.containerWidth === void 0 && $$bindings.containerWidth && containerWidth !== void 0) $$bindings.containerWidth(containerWidth);
	if ($$props.containerHeight === void 0 && $$bindings.containerHeight && containerHeight !== void 0) $$bindings.containerHeight(containerHeight);
	if ($$props.element === void 0 && $$bindings.element && element !== void 0) $$bindings.element(element);
	if ($$props.x === void 0 && $$bindings.x && x !== void 0) $$bindings.x(x);
	if ($$props.y === void 0 && $$bindings.y && y !== void 0) $$bindings.y(y);
	if ($$props.z === void 0 && $$bindings.z && z !== void 0) $$bindings.z(z);
	if ($$props.r === void 0 && $$bindings.r && r !== void 0) $$bindings.r(r);
	if ($$props.data === void 0 && $$bindings.data && data !== void 0) $$bindings.data(data);
	if ($$props.xDomain === void 0 && $$bindings.xDomain && xDomain !== void 0) $$bindings.xDomain(xDomain);
	if ($$props.yDomain === void 0 && $$bindings.yDomain && yDomain !== void 0) $$bindings.yDomain(yDomain);
	if ($$props.zDomain === void 0 && $$bindings.zDomain && zDomain !== void 0) $$bindings.zDomain(zDomain);
	if ($$props.rDomain === void 0 && $$bindings.rDomain && rDomain !== void 0) $$bindings.rDomain(rDomain);
	if ($$props.xNice === void 0 && $$bindings.xNice && xNice !== void 0) $$bindings.xNice(xNice);
	if ($$props.yNice === void 0 && $$bindings.yNice && yNice !== void 0) $$bindings.yNice(yNice);
	if ($$props.zNice === void 0 && $$bindings.zNice && zNice !== void 0) $$bindings.zNice(zNice);
	if ($$props.rNice === void 0 && $$bindings.rNice && rNice !== void 0) $$bindings.rNice(rNice);
	if ($$props.xPadding === void 0 && $$bindings.xPadding && xPadding !== void 0) $$bindings.xPadding(xPadding);
	if ($$props.yPadding === void 0 && $$bindings.yPadding && yPadding !== void 0) $$bindings.yPadding(yPadding);
	if ($$props.zPadding === void 0 && $$bindings.zPadding && zPadding !== void 0) $$bindings.zPadding(zPadding);
	if ($$props.rPadding === void 0 && $$bindings.rPadding && rPadding !== void 0) $$bindings.rPadding(rPadding);
	if ($$props.xScale === void 0 && $$bindings.xScale && xScale !== void 0) $$bindings.xScale(xScale);
	if ($$props.yScale === void 0 && $$bindings.yScale && yScale !== void 0) $$bindings.yScale(yScale);
	if ($$props.zScale === void 0 && $$bindings.zScale && zScale !== void 0) $$bindings.zScale(zScale);
	if ($$props.rScale === void 0 && $$bindings.rScale && rScale !== void 0) $$bindings.rScale(rScale);
	if ($$props.xRange === void 0 && $$bindings.xRange && xRange !== void 0) $$bindings.xRange(xRange);
	if ($$props.yRange === void 0 && $$bindings.yRange && yRange !== void 0) $$bindings.yRange(yRange);
	if ($$props.zRange === void 0 && $$bindings.zRange && zRange !== void 0) $$bindings.zRange(zRange);
	if ($$props.rRange === void 0 && $$bindings.rRange && rRange !== void 0) $$bindings.rRange(rRange);
	if ($$props.xReverse === void 0 && $$bindings.xReverse && xReverse !== void 0) $$bindings.xReverse(xReverse);
	if ($$props.yReverse === void 0 && $$bindings.yReverse && yReverse !== void 0) $$bindings.yReverse(yReverse);
	if ($$props.zReverse === void 0 && $$bindings.zReverse && zReverse !== void 0) $$bindings.zReverse(zReverse);
	if ($$props.rReverse === void 0 && $$bindings.rReverse && rReverse !== void 0) $$bindings.rReverse(rReverse);
	if ($$props.padding === void 0 && $$bindings.padding && padding !== void 0) $$bindings.padding(padding);
	if ($$props.extents === void 0 && $$bindings.extents && extents !== void 0) $$bindings.extents(extents);
	if ($$props.flatData === void 0 && $$bindings.flatData && flatData !== void 0) $$bindings.flatData(flatData);
	if ($$props.custom === void 0 && $$bindings.custom && custom !== void 0) $$bindings.custom(custom);
	if ($$props.debug === void 0 && $$bindings.debug && debug !== void 0) $$bindings.debug(debug);
	$$result.css.add(css$4);

	yReverseValue = typeof yReverse === 'undefined'
	? typeof yScale.bandwidth === 'function' ? false : true
	: yReverse;

	{
		if (x) config.x = x;
	}

	{
		if (y) config.y = y;
	}

	{
		if (z) config.z = z;
	}

	{
		if (r) config.r = r;
	}

	{
		if (xDomain) config.xDomain = xDomain;
	}

	{
		if (yDomain) config.yDomain = yDomain;
	}

	{
		if (zDomain) config.zDomain = zDomain;
	}

	{
		if (rDomain) config.rDomain = rDomain;
	}

	{
		if (xRange) config.xRange = xRange;
	}

	{
		if (yRange) config.yRange = yRange;
	}

	{
		if (zRange) config.zRange = zRange;
	}

	{
		if (rRange) config.rRange = rRange;
	}

	set_store_value(_percentRange, $_percentRange = percentRange, $_percentRange);
	set_store_value(_containerWidth, $_containerWidth = containerWidth, $_containerWidth);
	set_store_value(_containerHeight, $_containerHeight = containerHeight, $_containerHeight);
	set_store_value(_extents, $_extents = filterObject(extents), $_extents);
	set_store_value(_data, $_data = data, $_data);
	set_store_value(_flatData, $_flatData = flatData || data, $_flatData);
	set_store_value(_padding, $_padding = padding, $_padding);
	set_store_value(_x, $_x = makeAccessor(x), $_x);
	set_store_value(_y, $_y = makeAccessor(y), $_y);
	set_store_value(_z, $_z = makeAccessor(z), $_z);
	set_store_value(_r, $_r = makeAccessor(r), $_r);
	set_store_value(_xDomain, $_xDomain = xDomain, $_xDomain);
	set_store_value(_yDomain, $_yDomain = yDomain, $_yDomain);
	set_store_value(_zDomain, $_zDomain = zDomain, $_zDomain);
	set_store_value(_rDomain, $_rDomain = rDomain, $_rDomain);
	set_store_value(_xNice, $_xNice = xNice, $_xNice);
	set_store_value(_yNice, $_yNice = yNice, $_yNice);
	set_store_value(_zNice, $_zNice = zNice, $_zNice);
	set_store_value(_rNice, $_rNice = rNice, $_rNice);
	set_store_value(_xReverse, $_xReverse = xReverse, $_xReverse);
	set_store_value(_yReverse, $_yReverse = yReverseValue, $_yReverse);
	set_store_value(_zReverse, $_zReverse = zReverse, $_zReverse);
	set_store_value(_rReverse, $_rReverse = rReverse, $_rReverse);
	set_store_value(_xPadding, $_xPadding = xPadding, $_xPadding);
	set_store_value(_yPadding, $_yPadding = yPadding, $_yPadding);
	set_store_value(_zPadding, $_zPadding = zPadding, $_zPadding);
	set_store_value(_rPadding, $_rPadding = rPadding, $_rPadding);
	set_store_value(_xRange, $_xRange = xRange, $_xRange);
	set_store_value(_yRange, $_yRange = yRange, $_yRange);
	set_store_value(_zRange, $_zRange = zRange, $_zRange);
	set_store_value(_rRange, $_rRange = rRange, $_rRange);
	set_store_value(_xScale, $_xScale = xScale, $_xScale);
	set_store_value(_yScale, $_yScale = yScale, $_yScale);
	set_store_value(_zScale, $_zScale = zScale, $_zScale);
	set_store_value(_rScale, $_rScale = rScale, $_rScale);
	set_store_value(_custom, $_custom = custom, $_custom);
	set_store_value(_config, $_config = config, $_config);

	context = {
		activeGetters: activeGetters_d,
		width: width_d,
		height: height_d,
		percentRange: _percentRange,
		aspectRatio: aspectRatio_d,
		containerWidth: _containerWidth,
		containerHeight: _containerHeight,
		x: _x,
		y: _y,
		z: _z,
		r: _r,
		custom: _custom,
		data: _data,
		xNice: _xNice,
		yNice: _yNice,
		zNice: _zNice,
		rNice: _rNice,
		xReverse: _xReverse,
		yReverse: _yReverse,
		zReverse: _zReverse,
		rReverse: _rReverse,
		xPadding: _xPadding,
		yPadding: _yPadding,
		zPadding: _zPadding,
		rPadding: _rPadding,
		padding: padding_d,
		flatData: _flatData,
		extents: extents_d,
		xDomain: xDomain_d,
		yDomain: yDomain_d,
		zDomain: zDomain_d,
		rDomain: rDomain_d,
		xRange: xRange_d,
		yRange: yRange_d,
		zRange: zRange_d,
		rRange: rRange_d,
		config: _config,
		xScale: xScale_d,
		xGet: xGet_d,
		yScale: yScale_d,
		yGet: yGet_d,
		zScale: zScale_d,
		zGet: zGet_d,
		rScale: rScale_d,
		rGet: rGet_d
	};

	{
		setContext('LayerCake', context);
	}

	{
		if ($box_d && debug === true && (ssr === true || typeof window !== 'undefined')) {
			// Call this as a debounce so that it doesn't get called multiple times as these vars get filled in
			printDebug_debounced({
				boundingBox: $box_d,
				activeGetters: $activeGetters_d,
				x: config.x,
				y: config.y,
				z: config.z,
				r: config.r,
				xScale: $xScale_d,
				yScale: $yScale_d,
				zScale: $zScale_d,
				rScale: $rScale_d
			});
		}
	}

	$$unsubscribe_rScale_d();
	$$unsubscribe_zScale_d();
	$$unsubscribe_yScale_d();
	$$unsubscribe_xScale_d();
	$$unsubscribe_activeGetters_d();
	$$unsubscribe_box_d();
	$$unsubscribe__config();
	$$unsubscribe__custom();
	$$unsubscribe__rScale();
	$$unsubscribe__zScale();
	$$unsubscribe__yScale();
	$$unsubscribe__xScale();
	$$unsubscribe__rRange();
	$$unsubscribe__zRange();
	$$unsubscribe__yRange();
	$$unsubscribe__xRange();
	$$unsubscribe__rPadding();
	$$unsubscribe__zPadding();
	$$unsubscribe__yPadding();
	$$unsubscribe__xPadding();
	$$unsubscribe__rReverse();
	$$unsubscribe__zReverse();
	$$unsubscribe__yReverse();
	$$unsubscribe__xReverse();
	$$unsubscribe__rNice();
	$$unsubscribe__zNice();
	$$unsubscribe__yNice();
	$$unsubscribe__xNice();
	$$unsubscribe__rDomain();
	$$unsubscribe__zDomain();
	$$unsubscribe__yDomain();
	$$unsubscribe__xDomain();
	$$unsubscribe__r();
	$$unsubscribe__z();
	$$unsubscribe__y();
	$$unsubscribe__x();
	$$unsubscribe__padding();
	$$unsubscribe__flatData();
	$$unsubscribe__data();
	$$unsubscribe__extents();
	$$unsubscribe__containerHeight();
	$$unsubscribe__containerWidth();
	$$unsubscribe__percentRange();
	$$unsubscribe_width_d();
	$$unsubscribe_height_d();
	$$unsubscribe_aspectRatio_d();
	$$unsubscribe_padding_d();
	$$unsubscribe_extents_d();
	$$unsubscribe_xDomain_d();
	$$unsubscribe_yDomain_d();
	$$unsubscribe_zDomain_d();
	$$unsubscribe_rDomain_d();
	$$unsubscribe_xRange_d();
	$$unsubscribe_yRange_d();
	$$unsubscribe_zRange_d();
	$$unsubscribe_rRange_d();
	$$unsubscribe_xGet_d();
	$$unsubscribe_yGet_d();
	$$unsubscribe_zGet_d();
	$$unsubscribe_rGet_d();

	return `${ssr === true || typeof window !== 'undefined'
	? `<div class="layercake-container svelte-vhzpsp"${add_styles({
			position,
			"top": position === 'absolute' ? '0' : null,
			"right": position === 'absolute' ? '0' : null,
			"bottom": position === 'absolute' ? '0' : null,
			"left": position === 'absolute' ? '0' : null,
			"pointer-events": pointerEvents === false ? 'none' : null
		})}${add_attribute("this", element, 0)}>${slots.default
		? slots.default({
				element,
				width: $width_d,
				height: $height_d,
				aspectRatio: $aspectRatio_d,
				containerWidth: $_containerWidth,
				containerHeight: $_containerHeight,
				activeGetters: $activeGetters_d,
				percentRange: $_percentRange,
				x: $_x,
				y: $_y,
				z: $_z,
				r: $_r,
				custom: $_custom,
				data: $_data,
				xNice: $_xNice,
				yNice: $_yNice,
				zNice: $_zNice,
				rNice: $_rNice,
				xReverse: $_xReverse,
				yReverse: $_yReverse,
				zReverse: $_zReverse,
				rReverse: $_rReverse,
				xPadding: $_xPadding,
				yPadding: $_yPadding,
				zPadding: $_zPadding,
				rPadding: $_rPadding,
				padding: $padding_d,
				flatData: $_flatData,
				extents: $extents_d,
				xDomain: $xDomain_d,
				yDomain: $yDomain_d,
				zDomain: $zDomain_d,
				rDomain: $rDomain_d,
				xRange: $xRange_d,
				yRange: $yRange_d,
				zRange: $zRange_d,
				rRange: $rRange_d,
				config: $_config,
				xScale: $xScale_d,
				xGet: $xGet_d,
				yScale: $yScale_d,
				yGet: $yGet_d,
				zScale: $zScale_d,
				zGet: $zGet_d,
				rScale: $rScale_d,
				rGet: $rGet_d
			})
		: ``}</div>`
	: ``}`;
});

/* node_modules/layercake/dist/layouts/Svg.svelte generated by Svelte v4.2.9 */

const css$3 = {
	code: "svg.svelte-u84d8d{position:absolute;top:0;left:0;overflow:visible}",
	map: "{\"version\":3,\"file\":\"Svg.svelte\",\"sources\":[\"Svg.svelte\"],\"sourcesContent\":[\"<!--\\n\\t@component\\n\\tSVG layout component\\n -->\\n<script>\\n\\timport { getContext } from 'svelte';\\n\\n\\t/** @type {Element} [element] The layer's `<svg>` tag. Useful for bindings. */\\n\\texport let element = undefined;\\n\\n\\t/** @type {Element} [innerElement] The layer's `<g>` tag. Useful for bindings. */\\n\\texport let innerElement = undefined;\\n\\n\\t/** @type {Number} [zIndex] The layer's z-index. */\\n\\texport let zIndex = undefined;\\n\\n\\t/** @type {Boolean} [pointerEvents] Set this to `false` to set `pointer-events: none;` on the entire layer. */\\n\\texport let pointerEvents = undefined;\\n\\n\\t/** @type {String} [viewBox] A string passed to the `viewBox` property on the `<svg>` tag. */\\n\\texport let viewBox = undefined;\\n\\n\\t/** @type {String} [label] A string passed to the `aria-label` property on the `<svg>` tag. */\\n\\texport let label = undefined;\\n\\n\\t/** @type {String} [labelledBy] A string passed to the `aria-labelledby property` on the `<svg>` tag. */\\n\\texport let labelledBy = undefined;\\n\\n\\t/** @type {String} [describedBy] A string passed to the `aria-describedby` property on the `<svg>` tag. */\\n\\texport let describedBy = undefined;\\n\\n\\t/** @type {String} [title] Shorthand to set the contents of `<title></title>` for accessibility. You can also set arbitrary HTML via the \\\"title\\\" slot but this is a convenient shorthand. If you use the \\\"title\\\" slot, this prop is ignored. */\\n\\texport let title = undefined;\\n\\n\\tconst { containerWidth, containerHeight, padding } = getContext('LayerCake');\\n</script>\\n\\n<svg\\n\\tbind:this={element}\\n\\tclass=\\\"layercake-layout-svg\\\"\\n\\t{viewBox}\\n\\twidth={$containerWidth}\\n\\theight={$containerHeight}\\n\\tstyle:z-index={zIndex}\\n\\tstyle:pointer-events={pointerEvents === false ? 'none' : null}\\n\\taria-label={label}\\n\\taria-labelledby={labelledBy}\\n\\taria-describedby={describedBy}\\n>\\n\\t<slot name=\\\"title\\\">{#if title}<title>{title}</title>{/if}</slot>\\n\\n\\t<defs>\\n\\t\\t<slot name=\\\"defs\\\"></slot>\\n\\t</defs>\\n\\t<g\\n\\t\\tbind:this={innerElement}\\n\\t\\tclass=\\\"layercake-layout-svg_g\\\"\\n\\t\\ttransform=\\\"translate({$padding.left}, {$padding.top})\\\">\\n\\t\\t<slot {element}></slot>\\n\\t</g>\\n</svg>\\n\\n<style>\\n\\tsvg {\\n\\t\\tposition: absolute;\\n\\t\\ttop: 0;\\n\\t\\tleft: 0;\\n\\t\\toverflow: visible;\\n\\t}\\n</style>\\n\"],\"names\":[],\"mappings\":\"AA+DC,iBAAI,CACH,QAAQ,CAAE,QAAQ,CAClB,GAAG,CAAE,CAAC,CACN,IAAI,CAAE,CAAC,CACP,QAAQ,CAAE,OACX\"}"
};

const Svg = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let $containerWidth, $$unsubscribe_containerWidth;
	let $containerHeight, $$unsubscribe_containerHeight;
	let $padding, $$unsubscribe_padding;
	let { element = undefined } = $$props;
	let { innerElement = undefined } = $$props;
	let { zIndex = undefined } = $$props;
	let { pointerEvents = undefined } = $$props;
	let { viewBox = undefined } = $$props;
	let { label = undefined } = $$props;
	let { labelledBy = undefined } = $$props;
	let { describedBy = undefined } = $$props;
	let { title = undefined } = $$props;
	const { containerWidth, containerHeight, padding } = getContext('LayerCake');
	$$unsubscribe_containerWidth = subscribe(containerWidth, value => $containerWidth = value);
	$$unsubscribe_containerHeight = subscribe(containerHeight, value => $containerHeight = value);
	$$unsubscribe_padding = subscribe(padding, value => $padding = value);
	if ($$props.element === void 0 && $$bindings.element && element !== void 0) $$bindings.element(element);
	if ($$props.innerElement === void 0 && $$bindings.innerElement && innerElement !== void 0) $$bindings.innerElement(innerElement);
	if ($$props.zIndex === void 0 && $$bindings.zIndex && zIndex !== void 0) $$bindings.zIndex(zIndex);
	if ($$props.pointerEvents === void 0 && $$bindings.pointerEvents && pointerEvents !== void 0) $$bindings.pointerEvents(pointerEvents);
	if ($$props.viewBox === void 0 && $$bindings.viewBox && viewBox !== void 0) $$bindings.viewBox(viewBox);
	if ($$props.label === void 0 && $$bindings.label && label !== void 0) $$bindings.label(label);
	if ($$props.labelledBy === void 0 && $$bindings.labelledBy && labelledBy !== void 0) $$bindings.labelledBy(labelledBy);
	if ($$props.describedBy === void 0 && $$bindings.describedBy && describedBy !== void 0) $$bindings.describedBy(describedBy);
	if ($$props.title === void 0 && $$bindings.title && title !== void 0) $$bindings.title(title);
	$$result.css.add(css$3);
	$$unsubscribe_containerWidth();
	$$unsubscribe_containerHeight();
	$$unsubscribe_padding();

	return `  <svg class="layercake-layout-svg svelte-u84d8d"${add_attribute("viewBox", viewBox, 0)}${add_attribute("width", $containerWidth, 0)}${add_attribute("height", $containerHeight, 0)}${add_attribute("aria-label", label, 0)}${add_attribute("aria-labelledby", labelledBy, 0)}${add_attribute("aria-describedby", describedBy, 0)}${add_styles({
		"z-index": zIndex,
		"pointer-events": pointerEvents === false ? 'none' : null
	})}${add_attribute("this", element, 0)}>${slots.title
	? slots.title({})
	: `${title ? `<title>${escape(title)}</title>` : ``}`}<defs>${slots.defs ? slots.defs({}) : ``}</defs><g class="layercake-layout-svg_g" transform="${"translate(" + escape($padding.left, true) + ", " + escape($padding.top, true) + ")"}"${add_attribute("this", innerElement, 0)}>${slots.default ? slots.default({ element }) : ``}</g></svg>`;
});

/* node_modules/layercake/dist/layouts/Canvas.svelte generated by Svelte v4.2.9 */

const Canvas = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let $$unsubscribe_height;
	let $$unsubscribe_width;
	let $padding, $$unsubscribe_padding;
	const { width, height, padding } = getContext('LayerCake');
	$$unsubscribe_width = subscribe(width, value => value);
	$$unsubscribe_height = subscribe(height, value => value);
	$$unsubscribe_padding = subscribe(padding, value => $padding = value);
	let { element = undefined } = $$props;
	let { context = undefined } = $$props;
	let { zIndex = undefined } = $$props;
	let { pointerEvents = undefined } = $$props;
	let { fallback = '' } = $$props;
	let { label = undefined } = $$props;
	let { labelledBy = undefined } = $$props;
	let { describedBy = undefined } = $$props;
	const cntxt = { ctx: writable({}) };

	setContext('canvas', cntxt);
	if ($$props.element === void 0 && $$bindings.element && element !== void 0) $$bindings.element(element);
	if ($$props.context === void 0 && $$bindings.context && context !== void 0) $$bindings.context(context);
	if ($$props.zIndex === void 0 && $$bindings.zIndex && zIndex !== void 0) $$bindings.zIndex(zIndex);
	if ($$props.pointerEvents === void 0 && $$bindings.pointerEvents && pointerEvents !== void 0) $$bindings.pointerEvents(pointerEvents);
	if ($$props.fallback === void 0 && $$bindings.fallback && fallback !== void 0) $$bindings.fallback(fallback);
	if ($$props.label === void 0 && $$bindings.label && label !== void 0) $$bindings.label(label);
	if ($$props.labelledBy === void 0 && $$bindings.labelledBy && labelledBy !== void 0) $$bindings.labelledBy(labelledBy);
	if ($$props.describedBy === void 0 && $$bindings.describedBy && describedBy !== void 0) $$bindings.describedBy(describedBy);

	{
		cntxt.ctx.set(context);
	}

	$$unsubscribe_height();
	$$unsubscribe_width();
	$$unsubscribe_padding();

	return `  <canvas class="layercake-layout-canvas"${add_styles(merge_ssr_styles("width:100%;height:100%;position:absolute;", {
		"z-index": zIndex,
		"pointer-events": pointerEvents === false ? 'none' : null,
		"top": $padding.top + 'px',
		"right": $padding.right + 'px',
		"bottom": $padding.bottom + 'px',
		"left": $padding.left + 'px'
	}))}${add_attribute("aria-label", label, 0)}${add_attribute("aria-labelledby", labelledBy, 0)}${add_attribute("aria-describedby", describedBy, 0)}${add_attribute("this", element, 0)}>${slots.fallback
	? slots.fallback({})
	: `${fallback ? `${escape(fallback)}` : ``}`}</canvas> ${slots.default ? slots.default({ element, context }) : ``}`;
});

function constant(x) {
  return function constant() {
    return x;
  };
}

function array(x) {
  return typeof x === "object" && "length" in x
    ? x // Array, TypedArray, NodeList, array-like
    : Array.from(x); // Map, Set, iterable, string, or anything else
}

function none$1(series, order) {
  if (!((n = series.length) > 1)) return;
  for (var i = 1, j, s0, s1 = series[order[0]], n, m = s1.length; i < n; ++i) {
    s0 = s1, s1 = series[order[i]];
    for (j = 0; j < m; ++j) {
      s1[j][1] += s1[j][0] = isNaN(s0[j][1]) ? s0[j][0] : s0[j][1];
    }
  }
}

function none(series) {
  var n = series.length, o = new Array(n);
  while (--n >= 0) o[n] = n;
  return o;
}

function stackValue(d, key) {
  return d[key];
}

function stackSeries(key) {
  const series = [];
  series.key = key;
  return series;
}

function stack() {
  var keys = constant([]),
      order = none,
      offset = none$1,
      value = stackValue;

  function stack(data) {
    var sz = Array.from(keys.apply(this, arguments), stackSeries),
        i, n = sz.length, j = -1,
        oz;

    for (const d of data) {
      for (i = 0, ++j; i < n; ++i) {
        (sz[i][j] = [0, +value(d, sz[i].key, j, data)]).data = d;
      }
    }

    for (i = 0, oz = array(order(sz)); i < n; ++i) {
      sz[oz[i]].index = i;
    }

    offset(sz, oz);
    return sz;
  }

  stack.keys = function(_) {
    return arguments.length ? (keys = typeof _ === "function" ? _ : constant(Array.from(_)), stack) : keys;
  };

  stack.value = function(_) {
    return arguments.length ? (value = typeof _ === "function" ? _ : constant(+_), stack) : value;
  };

  stack.order = function(_) {
    return arguments.length ? (order = _ == null ? none : typeof _ === "function" ? _ : constant(Array.from(_)), stack) : order;
  };

  stack.offset = function(_) {
    return arguments.length ? (offset = _ == null ? none$1 : _, stack) : offset;
  };

  return stack;
}

/* src/routes/seqplot/stream/Dodger.svelte generated by Svelte v4.2.9 */

const Dodger = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let $yScale, $$unsubscribe_yScale;
	const { xRange, yRange, yScale, width } = getContext('LayerCake');
	$$unsubscribe_yScale = subscribe(yScale, value => $yScale = value);
	let { offSet = 0 } = $$props;
	let { i = 0 } = $$props;
	let { y = 0 } = $$props;
	let { stack = [] } = $$props;
	if ($$props.offSet === void 0 && $$bindings.offSet && offSet !== void 0) $$bindings.offSet(offSet);
	if ($$props.i === void 0 && $$bindings.i && i !== void 0) $$bindings.i(i);
	if ($$props.y === void 0 && $$bindings.y && y !== void 0) $$bindings.y(y);
	if ($$props.stack === void 0 && $$bindings.stack && stack !== void 0) $$bindings.stack(stack);

	{
		{
			stack = stack.map(d => ({ d, coord: $yScale(d) }));

			for (let i in stack) {
				//die einträge gehen von oben nach unten
				// d.h. die y-werte werden kleiner
				// also sollte der jetzige wert kleiner sein als der vorausgehende
				if (stack[i].coord + offSet > stack[i - 1]?.coord) stack[i].coord = stack[i - 1]?.coord - offSet;
			}
		}
	}

	$$unsubscribe_yScale();
	return `${slots.default ? slots.default({ d: stack }) : ``}`;
});

/* src/routes/seqplot/stream/AxisY.svelte generated by Svelte v4.2.9 */

const css$2 = {
	code: ".tick.svelte-zyly5l.svelte-zyly5l{font-size:11px}.tick.svelte-zyly5l line.svelte-zyly5l{stroke:#aaa}.tick.svelte-zyly5l .gridline.svelte-zyly5l{stroke-dasharray:2}.tick.svelte-zyly5l text.svelte-zyly5l{fill:#666}.tick.tick-0.svelte-zyly5l line.svelte-zyly5l{stroke-dasharray:0}",
	map: "{\"version\":3,\"file\":\"AxisY.svelte\",\"sources\":[\"AxisY.svelte\"],\"sourcesContent\":[\"<!--\\n  @component\\n  Generates an SVG y-axis. This component is also configured to detect if your y-scale is an ordinal scale. If so, it will place the tickMarks in the middle of the bandwidth.\\n -->\\n <script>\\n\\n  import { getContext } from 'svelte';\\n  import Dodger from './Dodger.svelte';\\n  const { xRange, yRange, yScale, width } = getContext('LayerCake');\\n\\n  /** @type {Boolean} [tickMarks=false] - Show marks next to the tick label. */\\n  export let tickMarks = false;\\n\\n  /** @type {Boolean} [tickMarks=false] - Show marks next to the tick label. */\\n  export let tickLabel = false;\\n\\n  /** @type {String} [labelPosition='even'] - Whether the label sits even with its value ('even') or sits on top ('above') the tick mark. Default is 'even'. */\\n  export let labelPosition = 'even';\\n\\n  /** @type {Boolean} [snapBaselineLabel=false] - When labelPosition='even', adjust the lowest label so that it sits above the tick mark. */\\n  export let snapBaselineLabel = false;\\n\\n  /** @type {Boolean} [gridlines=true] - Show gridlines extending into the chart area. */\\n  export let gridlines = true;\\n\\n  /** @type {Number} [tickMarkLength=undefined] - The length of the tick mark. If not set, becomes the length of the widest tick. */\\n  export let tickMarkLength = undefined;\\n\\n  /** @type {Function} [format=d => d] - A function that passes the current tick value and expects a nicely formatted value in return. */\\n  export let format = d => d ;\\n\\n  /** @type {Number|Array|Function} [ticks=4] - If this is a number, it passes that along to the [d3Scale.ticks](https://github.com/d3/d3-scale) function. If this is an array, hardcodes the ticks to those values. If it's a function, passes along the default tick values and expects an array of tick values in return. */\\n  export let ticks = 4;\\n\\n  /** @type {Number} [tickGutter=0] - The amount of whitespace between the start of the tick and the chart drawing area (the xRange min). */\\n  export let tickGutter = 0;\\n\\n  /** @type {Number} [dx=0] - Any optional value passed to the `dx` attribute on the text label. */\\n  export let dx = 0;\\n\\n  /** @type {Number} [dy=0] - Any optional value passed to the `dy` attribute on the text label. */\\n  export let dy = 0;\\n\\n  export let offsetY = 0;\\n\\n  /** @type {Number} [charPixelWidth=7.25] - Used to calculate the widest label length to offset labels. Adjust if the automatic tick length doesn't look right because you have a bigger font (or just set `tickMarkLength` to a pixel value). */\\n  export let charPixelWidth = 7.25;\\n\\n  export let tickMap;\\n\\n  export let axisLine;\\n\\n  export let offSet = 0;\\n\\n  $: isBandwidth = typeof $yScale.bandwidth === 'function';\\n\\n  $: tickVals = Array.isArray(ticks) ? ticks :\\n    isBandwidth ?\\n      $yScale.domain() :\\n      typeof ticks === 'function' ?\\n        ticks($yScale.ticks()) :\\n          $yScale.ticks(ticks);\\n\\n  function calcStringLength(sum, val) {\\n    if (val === ',' || val === '.') return sum + charPixelWidth * 0.5;\\n    return sum + charPixelWidth;\\n  }\\n\\n  $: tickLen = tickMarks === true\\n    ? labelPosition === 'above'\\n      ? tickMarkLength ?? widestTickLen\\n      : tickMarkLength ?? 6\\n    : 0;\\n\\n  $: widestTickLen = Math.max(10, Math.max(...tickVals.map(d => format(d).toString().split('').reduce(calcStringLength, 0))));\\n\\n  $: x1 = -tickGutter - (labelPosition === 'above' ? widestTickLen : tickLen);\\n  $: y = isBandwidth ? $yScale.bandwidth() / 2 : 0;\\n\\n  $: maxTickValPx = Math.max(...tickVals.map($yScale));\\n\\n</script>\\n\\n<g class='axis y-axis'>\\n  {#if axisLine}\\n  <line\\n    {x1}\\n    x2={x1}\\n    y1={tickVals.map($yScale)[0]}\\n    y2={tickVals.map($yScale)[tickVals.length-1]}\\n    style=\\\"stroke-width: 1; stroke: #aaa;\\\"\\n    ></line>\\n{/if}\\n\\n\\n<Dodger stack = {tickVals} let:d {offSet}  >\\n\\n  {#each d as tick,i (tick)}\\n    {@const tickValPx = $yScale(tick.d)}\\n    <g class='tick tick-{tick}' transform='translate({$xRange[0]}, {tickValPx})'>\\n      {#if gridlines === true}\\n        <line\\n          class=\\\"gridline\\\"\\n          {x1}\\n          x2='{$width}'\\n          y1={y}\\n          y2={y}\\n        ></line>\\n      {/if}\\n      {#if tickMarks === true}\\n        <line\\n          class='tick-mark'\\n          {x1}\\n          x2={x1 + tickLen}\\n          y1={tick.coord - tickValPx}\\n          y2={y}\\n        ></line>\\n      {/if}\\n      {#if tickLabel === true}\\n          <text\\n          x='{x1}'\\n          y = {tick.coord - tickValPx}\\n          dx={dx + (labelPosition === 'even' ? -3 : 0)}\\n          text-anchor={labelPosition === 'above' ? 'start' : 'end'}\\n          dy='{dy + (labelPosition === 'above' || (snapBaselineLabel === true && tickValPx === maxTickValPx) ? -3 : 4)}'\\n        >{tickMap ? tickMap.get(tick.d) : format(tick) }</text>\\n\\n      {/if}\\n\\n    </g>\\n  {/each}\\n</Dodger>\\n\\n</g>\\n\\n<style>\\n  .tick {\\n    font-size: 11px;\\n  }\\n\\n  .tick line {\\n    stroke: #aaa;\\n  }\\n  .tick .gridline {\\n    stroke-dasharray: 2;\\n  }\\n\\n  .tick text {\\n    fill: #666;\\n  }\\n\\n  .tick.tick-0 line {\\n    stroke-dasharray: 0;\\n  }\\n</style>\\n\"],\"names\":[],\"mappings\":\"AAwIE,iCAAM,CACJ,SAAS,CAAE,IACb,CAEA,mBAAK,CAAC,kBAAK,CACT,MAAM,CAAE,IACV,CACA,mBAAK,CAAC,uBAAU,CACd,gBAAgB,CAAE,CACpB,CAEA,mBAAK,CAAC,kBAAK,CACT,IAAI,CAAE,IACR,CAEA,KAAK,qBAAO,CAAC,kBAAK,CAChB,gBAAgB,CAAE,CACpB\"}"
};

const AxisY = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let isBandwidth;
	let tickVals;
	let tickLen;
	let widestTickLen;
	let x1;
	let y;
	let maxTickValPx;
	let $yScale, $$unsubscribe_yScale;
	let $xRange, $$unsubscribe_xRange;
	let $width, $$unsubscribe_width;
	const { xRange, yRange, yScale, width } = getContext('LayerCake');
	$$unsubscribe_xRange = subscribe(xRange, value => $xRange = value);
	$$unsubscribe_yScale = subscribe(yScale, value => $yScale = value);
	$$unsubscribe_width = subscribe(width, value => $width = value);
	let { tickMarks = false } = $$props;
	let { tickLabel = false } = $$props;
	let { labelPosition = 'even' } = $$props;
	let { snapBaselineLabel = false } = $$props;
	let { gridlines = true } = $$props;
	let { tickMarkLength = undefined } = $$props;
	let { format = d => d } = $$props;
	let { ticks = 4 } = $$props;
	let { tickGutter = 0 } = $$props;
	let { dx = 0 } = $$props;
	let { dy = 0 } = $$props;
	let { offsetY = 0 } = $$props;
	let { charPixelWidth = 7.25 } = $$props;
	let { tickMap } = $$props;
	let { axisLine } = $$props;
	let { offSet = 0 } = $$props;

	function calcStringLength(sum, val) {
		if (val === ',' || val === '.') return sum + charPixelWidth * 0.5;
		return sum + charPixelWidth;
	}

	if ($$props.tickMarks === void 0 && $$bindings.tickMarks && tickMarks !== void 0) $$bindings.tickMarks(tickMarks);
	if ($$props.tickLabel === void 0 && $$bindings.tickLabel && tickLabel !== void 0) $$bindings.tickLabel(tickLabel);
	if ($$props.labelPosition === void 0 && $$bindings.labelPosition && labelPosition !== void 0) $$bindings.labelPosition(labelPosition);
	if ($$props.snapBaselineLabel === void 0 && $$bindings.snapBaselineLabel && snapBaselineLabel !== void 0) $$bindings.snapBaselineLabel(snapBaselineLabel);
	if ($$props.gridlines === void 0 && $$bindings.gridlines && gridlines !== void 0) $$bindings.gridlines(gridlines);
	if ($$props.tickMarkLength === void 0 && $$bindings.tickMarkLength && tickMarkLength !== void 0) $$bindings.tickMarkLength(tickMarkLength);
	if ($$props.format === void 0 && $$bindings.format && format !== void 0) $$bindings.format(format);
	if ($$props.ticks === void 0 && $$bindings.ticks && ticks !== void 0) $$bindings.ticks(ticks);
	if ($$props.tickGutter === void 0 && $$bindings.tickGutter && tickGutter !== void 0) $$bindings.tickGutter(tickGutter);
	if ($$props.dx === void 0 && $$bindings.dx && dx !== void 0) $$bindings.dx(dx);
	if ($$props.dy === void 0 && $$bindings.dy && dy !== void 0) $$bindings.dy(dy);
	if ($$props.offsetY === void 0 && $$bindings.offsetY && offsetY !== void 0) $$bindings.offsetY(offsetY);
	if ($$props.charPixelWidth === void 0 && $$bindings.charPixelWidth && charPixelWidth !== void 0) $$bindings.charPixelWidth(charPixelWidth);
	if ($$props.tickMap === void 0 && $$bindings.tickMap && tickMap !== void 0) $$bindings.tickMap(tickMap);
	if ($$props.axisLine === void 0 && $$bindings.axisLine && axisLine !== void 0) $$bindings.axisLine(axisLine);
	if ($$props.offSet === void 0 && $$bindings.offSet && offSet !== void 0) $$bindings.offSet(offSet);
	$$result.css.add(css$2);
	isBandwidth = typeof $yScale.bandwidth === 'function';

	tickVals = Array.isArray(ticks)
	? ticks
	: isBandwidth
		? $yScale.domain()
		: typeof ticks === 'function'
			? ticks($yScale.ticks())
			: $yScale.ticks(ticks);

	widestTickLen = Math.max(10, Math.max(...tickVals.map(d => format(d).toString().split('').reduce(calcStringLength, 0))));

	tickLen = tickMarks === true
	? labelPosition === 'above'
		? tickMarkLength ?? widestTickLen
		: tickMarkLength ?? 6
	: 0;

	x1 = -tickGutter - (labelPosition === 'above' ? widestTickLen : tickLen);
	y = isBandwidth ? $yScale.bandwidth() / 2 : 0;
	maxTickValPx = Math.max(...tickVals.map($yScale));
	$$unsubscribe_yScale();
	$$unsubscribe_xRange();
	$$unsubscribe_width();

	return `  <g class="axis y-axis">${axisLine
	? `<line${add_attribute("x1", x1, 0)}${add_attribute("x2", x1, 0)}${add_attribute("y1", tickVals.map($yScale)[0], 0)}${add_attribute("y2", tickVals.map($yScale)[tickVals.length - 1], 0)} style="stroke-width: 1; stroke: #aaa;"></line>`
	: ``}${validate_component(Dodger, "Dodger").$$render($$result, { stack: tickVals, offSet }, {}, {
		default: ({ d }) => {
			return `${each(d, (tick, i) => {
				let tickValPx = $yScale(tick.d);

				return ` <g class="${"tick tick-" + escape(tick, true) + " svelte-zyly5l"}" transform="${"translate(" + escape($xRange[0], true) + ", " + escape(tickValPx, true) + ")"}">${gridlines === true
				? `<line class="gridline svelte-zyly5l"${add_attribute("x1", x1, 0)}${add_attribute("x2", $width, 0)}${add_attribute("y1", y, 0)}${add_attribute("y2", y, 0)}></line>`
				: ``}${tickMarks === true
				? `<line class="tick-mark svelte-zyly5l"${add_attribute("x1", x1, 0)}${add_attribute("x2", x1 + tickLen, 0)}${add_attribute("y1", tick.coord - tickValPx, 0)}${add_attribute("y2", y, 0)}></line>`
				: ``}${tickLabel === true
				? `<text${add_attribute("x", x1, 0)}${add_attribute("y", tick.coord - tickValPx, 0)}${add_attribute("dx", dx + (labelPosition === 'even' ? -3 : 0), 0)}${add_attribute("text-anchor", labelPosition === 'above' ? 'start' : 'end', 0)}${add_attribute(
						"dy",
						dy + (labelPosition === 'above' || snapBaselineLabel === true && tickValPx === maxTickValPx
						? -3
						: 4),
						0
					)} class="svelte-zyly5l">${escape(tickMap ? tickMap.get(tick.d) : format(tick))}</text>`
				: ``}</g>`;
			})}`;
		}
	})}</g>`;
});

/**
 * @param {any} obj
 * @returns {boolean}
 */
function is_date(obj) {
	return Object.prototype.toString.call(obj) === '[object Date]';
}

/** @returns {(t: any) => any} */
function get_interpolator(a, b) {
	if (a === b || a !== a) return () => a;
	const type = typeof a;
	if (type !== typeof b || Array.isArray(a) !== Array.isArray(b)) {
		throw new Error('Cannot interpolate values of different type');
	}
	if (Array.isArray(a)) {
		const arr = b.map((bi, i) => {
			return get_interpolator(a[i], bi);
		});
		return (t) => arr.map((fn) => fn(t));
	}
	if (type === 'object') {
		if (!a || !b) throw new Error('Object cannot be null');
		if (is_date(a) && is_date(b)) {
			a = a.getTime();
			b = b.getTime();
			const delta = b - a;
			return (t) => new Date(a + t * delta);
		}
		const keys = Object.keys(b);
		const interpolators = {};
		keys.forEach((key) => {
			interpolators[key] = get_interpolator(a[key], b[key]);
		});
		return (t) => {
			const result = {};
			keys.forEach((key) => {
				result[key] = interpolators[key](t);
			});
			return result;
		};
	}
	if (type === 'number') {
		const delta = b - a;
		return (t) => a + t * delta;
	}
	throw new Error(`Cannot interpolate ${type} values`);
}

/**
 * A tweened store in Svelte is a special type of store that provides smooth transitions between state values over time.
 *
 * https://svelte.dev/docs/svelte-motion#tweened
 * @template T
 * @param {T} [value]
 * @param {import('./private.js').TweenedOptions<T>} [defaults]
 * @returns {import('./public.js').Tweened<T>}
 */
function tweened(value, defaults = {}) {
	const store = writable(value);
	/** @type {import('../internal/private.js').Task} */
	let task;
	let target_value = value;
	/**
	 * @param {T} new_value
	 * @param {import('./private.js').TweenedOptions<T>} [opts]
	 */
	function set(new_value, opts) {
		if (value == null) {
			store.set((value = new_value));
			return Promise.resolve();
		}
		target_value = new_value;
		let previous_task = task;
		let started = false;
		let {
			delay = 0,
			duration = 400,
			easing = identity$4,
			interpolate = get_interpolator
		} = assign(assign({}, defaults), opts);
		if (duration === 0) {
			if (previous_task) {
				previous_task.abort();
				previous_task = null;
			}
			store.set((value = target_value));
			return Promise.resolve();
		}
		const start = now() + delay;
		let fn;
		task = loop((now) => {
			if (now < start) return true;
			if (!started) {
				fn = interpolate(value, new_value);
				if (typeof duration === 'function') duration = duration(value, new_value);
				started = true;
			}
			if (previous_task) {
				previous_task.abort();
				previous_task = null;
			}
			const elapsed = now - start;
			if (elapsed > /** @type {number} */ (duration)) {
				store.set((value = new_value));
				return false;
			}
			// @ts-ignore
			store.set((value = fn(easing(elapsed / duration))));
			return true;
		});
		return task.promise;
	}
	return {
		set,
		update: (fn, opts) => set(fn(target_value, value), opts),
		subscribe: store.subscribe
	};
}

/* src/routes/seqplot/stream/Curve.canvas.svelte generated by Svelte v4.2.9 */

const Curve_canvas = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let $yScale, $$unsubscribe_yScale;
	let $xScale, $$unsubscribe_xScale;
	const { data, x, width, height, xScale, xGet, y, yGet, yScale, zScale } = getContext('LayerCake');
	$$unsubscribe_xScale = subscribe(xScale, value => $xScale = value);
	$$unsubscribe_yScale = subscribe(yScale, value => $yScale = value);
	let { row = [] } = $$props;
	let { strokeStyle = 'rgb(255,0,0,0.1 )' } = $$props;
	let { a = 0 } = $$props;
	let item = drawLine;
	getContext('canvas').addItem(item);

	function drawLine(ctx) {
		ctx.save();
		let k = row;
		let _k = (1 - a) / 6;
		ctx.strokeStyle = strokeStyle;
		let _x, _y, _x0, _x1, _x2, _y0, _y1, _y2;

		/* round zero: initialize */
		_x = $xScale(k[0].x);

		_y = $yScale(k[0].y);
		ctx.beginPath();
		ctx.moveTo(_x, _y);
		_x2 = _x;
		_y2 = _y;

		/* round one: past points */
		_x = $xScale(k[0].x);

		_y = $yScale(k[0].y);
		(_x1 = _x, _y1 = _y);
		(_x0 = _x1, _x1 = _x2, _x2 = _x);
		(_y0 = _y1, _y1 = _y2, _y2 = _y);

		k.forEach(d => {
			_x = $xScale(d.x);
			_y = $yScale(d.y);
			ctx.bezierCurveTo(_x1 + _k * (_x2 - _x0), _y1 + _k * (_y2 - _y0), _x2 + _k * (_x1 - _x), _y2 + _k * (_y1 - _y), _x2, _y2);
			(_x0 = _x1, _x1 = _x2, _x2 = _x);
			(_y0 = _y1, _y1 = _y2, _y2 = _y);
		});

		//closing the last part
		ctx.bezierCurveTo(_x1 + _k * (_x2 - _x0), _y1 + _k * (_y2 - _y0), _x2 + _k * (_x1 - _x1), _y2 + _k * (_y1 - _y1), _x2, _y2);

		ctx.stroke();
		ctx.restore();
	}

	if ($$props.row === void 0 && $$bindings.row && row !== void 0) $$bindings.row(row);
	if ($$props.strokeStyle === void 0 && $$bindings.strokeStyle && strokeStyle !== void 0) $$bindings.strokeStyle(strokeStyle);
	if ($$props.a === void 0 && $$bindings.a && a !== void 0) $$bindings.a(a);
	$$unsubscribe_yScale();
	$$unsubscribe_xScale();
	return ``;
});

/* src/routes/seqplot/stream/CanvasController.svelte generated by Svelte v4.2.9 */

const CanvasController = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let $ctx, $$unsubscribe_ctx;
	let $$unsubscribe_height;
	let $$unsubscribe_width;
	let $data, $$unsubscribe_data;
	let $y, $$unsubscribe_y;
	const { data, x, width, height, xScale, xGet, y, yGet, yScale, zScale } = getContext('LayerCake');
	$$unsubscribe_data = subscribe(data, value => $data = value);
	$$unsubscribe_width = subscribe(width, value => value);
	$$unsubscribe_height = subscribe(height, value => value);
	$$unsubscribe_y = subscribe(y, value => $y = value);
	const { ctx } = getContext('canvas');
	$$unsubscribe_ctx = subscribe(ctx, value => $ctx = value);
	setContext("canvas", { addItem });

	function addItem(fn) {
	}

	$$unsubscribe_ctx();
	$$unsubscribe_height();
	$$unsubscribe_width();
	$$unsubscribe_data();
	$$unsubscribe_y();

	return `${$ctx
	? `${each($data, row => {
			return `${validate_component(Curve_canvas, "Curve").$$render($$result, { row: $y(row) }, {}, {})}`;
		})}`
	: ``}`;
});

/* src/routes/seqplot/stream/AxisX.svelte generated by Svelte v4.2.9 */

const css$1 = {
	code: ".tick.svelte-wr6453.svelte-wr6453{font-size:0.725em;font-weight:200}line.svelte-wr6453.svelte-wr6453,.tick.svelte-wr6453 line.svelte-wr6453{stroke:#aaa;stroke-dasharray:2}.tick.svelte-wr6453 text.svelte-wr6453{fill:#666}.tick.svelte-wr6453 .tick-mark.svelte-wr6453,.baseline.svelte-wr6453.svelte-wr6453{stroke-dasharray:0}.axis.snapTicks.svelte-wr6453 .tick:last-child text.svelte-wr6453{transform:translateX(3px)}.axis.snapTicks.svelte-wr6453 .tick.tick-0 text.svelte-wr6453{transform:translateX(-3px)}",
	map: "{\"version\":3,\"file\":\"AxisX.svelte\",\"sources\":[\"AxisX.svelte\"],\"sourcesContent\":[\"<!--\\n  @component\\n  Generates an SVG x-axis. This component is also configured to detect if your x-scale is an ordinal scale. If so, it will place the markers in the middle of the bandwidth.\\n -->\\n <script>\\n  import { getContext } from 'svelte';\\n  const { width, height, xScale, yRange } = getContext('LayerCake');\\n\\n  /** @type {Boolean} [gridlines=true] - Extend lines from the ticks into the chart space */\\n  export let gridlines = true;\\n\\n  /** @type {Boolean} [tickMarks=false] - Show a vertical mark for each tick. */\\n  export let tickMarks = false;\\n\\n  /** @type {Boolean} [baseline=false] – Show a solid line at the bottom. */\\n  export let baseline = false;\\n\\n  /** @type {Boolean} [snapTicks=false] - Instead of centering the text on the first and the last items, align them to the edges of the chart. */\\n  export let snapTicks = false;\\n\\n  /** @type {Function} [formatTick=d => d] - A function that passes the current tick value and expects a nicely formatted value in return. */\\n  export let formatTick = d => d;\\n\\n  /** @type {Number|Array|Function} [ticks] - If this is a number, it passes that along to the [d3Scale.ticks](https://github.com/d3/d3-scale) function. If this is an array, hardcodes the ticks to those values. If it's a function, passes along the default tick values and expects an array of tick values in return. If nothing, it uses the default ticks supplied by the D3 function. */\\n  export let ticks = undefined;\\n\\n  /** @type {Number} [xTick=0] - How far over to position the text marker. */\\n  export let xTick = 0;\\n\\n  /** @type {Number} [yTick=16] - The distance from the baseline to place each tick value. */\\n  export let yTick = 16;\\n\\n  $: isBandwidth = typeof $xScale.bandwidth === 'function';\\n\\n  $: tickVals = Array.isArray(ticks) ? ticks :\\n    isBandwidth ?\\n      $xScale.domain() :\\n      typeof ticks === 'function' ?\\n        ticks($xScale.ticks()) :\\n          $xScale.ticks(ticks);\\n\\n  function textAnchor(i) {\\n    if (snapTicks === true) {\\n      if (i === 0) {\\n        return 'start';\\n      }\\n      if (i === tickVals.length - 1) {\\n        return 'end';\\n      }\\n    }\\n    return 'middle';\\n  }\\n</script>\\n\\n<g class=\\\"axis x-axis\\\" class:snapTicks>\\n  {#each tickVals as tick, i (tick)}\\n    <g class=\\\"tick tick-{i}\\\" transform=\\\"translate({$xScale(tick)},{Math.max(...$yRange)})\\\">\\n      {#if gridlines !== false}\\n        <line class=\\\"gridline\\\" y1={$height * -1} y2=\\\"0\\\" x1=\\\"0\\\" x2=\\\"0\\\" />\\n      {/if}\\n      {#if tickMarks === true}\\n        <line\\n          class=\\\"tick-mark\\\"\\n          y1={0}\\n          y2={6}\\n          x1={isBandwidth ? $xScale.bandwidth() / 2 : 0}\\n          x2={isBandwidth ? $xScale.bandwidth() / 2 : 0}\\n        />\\n      {/if}\\n      <text\\n        x={isBandwidth ? ( + xTick) : xTick}\\n        y={yTick}\\n        dx=\\\"\\\"\\n        dy=\\\"\\\"\\n        text-anchor={textAnchor(i)}>{formatTick(tick)}</text\\n      >\\n    </g>\\n  {/each}\\n  {#if baseline === true}\\n    <line class=\\\"baseline\\\" y1={$height + 0.5} y2={$height + 0.5} x1=\\\"0\\\" x2={$width} />\\n  {/if}\\n</g>\\n\\n<style>\\n  .tick {\\n    font-size: 0.725em;\\n    font-weight: 200;\\n  }\\n\\n  line,\\n  .tick line {\\n    stroke: #aaa;\\n    stroke-dasharray: 2;\\n  }\\n\\n  .tick text {\\n    fill: #666;\\n  }\\n\\n  .tick .tick-mark,\\n  .baseline {\\n    stroke-dasharray: 0;\\n  }\\n  /* This looks slightly better */\\n  .axis.snapTicks .tick:last-child text {\\n    transform: translateX(3px);\\n  }\\n  .axis.snapTicks .tick.tick-0 text {\\n    transform: translateX(-3px);\\n  }\\n</style>\\n\"],\"names\":[],\"mappings\":\"AAoFE,iCAAM,CACJ,SAAS,CAAE,OAAO,CAClB,WAAW,CAAE,GACf,CAEA,gCAAI,CACJ,mBAAK,CAAC,kBAAK,CACT,MAAM,CAAE,IAAI,CACZ,gBAAgB,CAAE,CACpB,CAEA,mBAAK,CAAC,kBAAK,CACT,IAAI,CAAE,IACR,CAEA,mBAAK,CAAC,wBAAU,CAChB,qCAAU,CACR,gBAAgB,CAAE,CACpB,CAEA,KAAK,wBAAU,CAAC,KAAK,WAAW,CAAC,kBAAK,CACpC,SAAS,CAAE,WAAW,GAAG,CAC3B,CACA,KAAK,wBAAU,CAAC,KAAK,OAAO,CAAC,kBAAK,CAChC,SAAS,CAAE,WAAW,IAAI,CAC5B\"}"
};

const AxisX = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let isBandwidth;
	let tickVals;
	let $xScale, $$unsubscribe_xScale;
	let $yRange, $$unsubscribe_yRange;
	let $height, $$unsubscribe_height;
	let $width, $$unsubscribe_width;
	const { width, height, xScale, yRange } = getContext('LayerCake');
	$$unsubscribe_width = subscribe(width, value => $width = value);
	$$unsubscribe_height = subscribe(height, value => $height = value);
	$$unsubscribe_xScale = subscribe(xScale, value => $xScale = value);
	$$unsubscribe_yRange = subscribe(yRange, value => $yRange = value);
	let { gridlines = true } = $$props;
	let { tickMarks = false } = $$props;
	let { baseline = false } = $$props;
	let { snapTicks = false } = $$props;
	let { formatTick = d => d } = $$props;
	let { ticks = undefined } = $$props;
	let { xTick = 0 } = $$props;
	let { yTick = 16 } = $$props;

	function textAnchor(i) {
		if (snapTicks === true) {
			if (i === 0) {
				return 'start';
			}

			if (i === tickVals.length - 1) {
				return 'end';
			}
		}

		return 'middle';
	}

	if ($$props.gridlines === void 0 && $$bindings.gridlines && gridlines !== void 0) $$bindings.gridlines(gridlines);
	if ($$props.tickMarks === void 0 && $$bindings.tickMarks && tickMarks !== void 0) $$bindings.tickMarks(tickMarks);
	if ($$props.baseline === void 0 && $$bindings.baseline && baseline !== void 0) $$bindings.baseline(baseline);
	if ($$props.snapTicks === void 0 && $$bindings.snapTicks && snapTicks !== void 0) $$bindings.snapTicks(snapTicks);
	if ($$props.formatTick === void 0 && $$bindings.formatTick && formatTick !== void 0) $$bindings.formatTick(formatTick);
	if ($$props.ticks === void 0 && $$bindings.ticks && ticks !== void 0) $$bindings.ticks(ticks);
	if ($$props.xTick === void 0 && $$bindings.xTick && xTick !== void 0) $$bindings.xTick(xTick);
	if ($$props.yTick === void 0 && $$bindings.yTick && yTick !== void 0) $$bindings.yTick(yTick);
	$$result.css.add(css$1);
	isBandwidth = typeof $xScale.bandwidth === 'function';

	tickVals = Array.isArray(ticks)
	? ticks
	: isBandwidth
		? $xScale.domain()
		: typeof ticks === 'function'
			? ticks($xScale.ticks())
			: $xScale.ticks(ticks);

	$$unsubscribe_xScale();
	$$unsubscribe_yRange();
	$$unsubscribe_height();
	$$unsubscribe_width();

	return `  <g class="${["axis x-axis svelte-wr6453", snapTicks ? "snapTicks" : ""].join(' ').trim()}">${each(tickVals, (tick, i) => {
		return `<g class="${"tick tick-" + escape(i, true) + " svelte-wr6453"}" transform="${"translate(" + escape($xScale(tick), true) + "," + escape(Math.max(...$yRange), true) + ")"}">${gridlines !== false
		? `<line class="gridline svelte-wr6453"${add_attribute("y1", $height * -1, 0)} y2="0" x1="0" x2="0"></line>`
		: ``}${tickMarks === true
		? `<line class="tick-mark svelte-wr6453"${add_attribute("y1", 0, 0)}${add_attribute("y2", 6, 0)}${add_attribute("x1", isBandwidth ? $xScale.bandwidth() / 2 : 0, 0)}${add_attribute("x2", isBandwidth ? $xScale.bandwidth() / 2 : 0, 0)}></line>`
		: ``}<text${add_attribute("x", isBandwidth ? +xTick : xTick, 0)}${add_attribute("y", yTick, 0)} dx="" dy=""${add_attribute("text-anchor", textAnchor(i), 0)} class="svelte-wr6453">${escape(formatTick(tick))}</text></g>`;
	})}${baseline === true
	? `<line class="baseline svelte-wr6453"${add_attribute("y1", $height + 0.5, 0)}${add_attribute("y2", $height + 0.5, 0)} x1="0"${add_attribute("x2", $width, 0)}></line>`
	: ``}</g>`;
});

/* src/routes/seqplot/stream/Stream.svelte generated by Svelte v4.2.9 */

const css = {
	code: ".chart-container.svelte-1rhinkp{width:100%;height:700px}",
	map: "{\"version\":3,\"file\":\"Stream.svelte\",\"sources\":[\"Stream.svelte\"],\"sourcesContent\":[\"<script>\\nimport {  LayerCake, Svg, Canvas} from 'layercake';\\nimport AxisY from './AxisY.svelte';\\n\\n\\nimport { tweened } from 'svelte/motion';\\n\\n\\nimport { scaleBand, scaleOrdinal } from 'd3-scale';\\nimport { stack } from 'd3-shape';\\nimport {rollup, max} from 'd3-array';\\n\\n\\nimport CanvasController from './CanvasController.svelte'\\n\\nimport AxisX from './AxisX.svelte';\\n\\nexport let position;\\nexport let yKey = [];\\nexport let data = [];\\nexport let alphabet = [];\\nexport let cpal = [];\\nexport let labels = [];\\nexport let ids = [];\\nexport let margins = [150,0, 150, 50]\\n// giving the data an id\\n\\n//general idea: stacked data layout in wide and dense\\n//pass in all x-y stuff\\n// give a count value, default: length\\n//return the catspan data and stack\\n\\ndata.forEach( (d,i) => d.id = ids[i])\\n\\nlet stateStack;\\nlet newData;\\nlet catSpan;\\nlet catMap;\\nlet positionScaler= position == 'top' ?  0 : position == \\\"bottom\\\" ?  1 :  0.5\\n\\nfunction prepareData (data){\\n\\n  stateStack = yKey.reduce( (map,key) =>{\\n  //count counts the occurences of each state for each time\\n  let count = rollup(data, (D) => D.length, (d) => d[key])\\n\\n\\n  //include the count stuff as a fourth component\\n  let baseLevel = new Map(stack().keys(alphabet)\\n                      ([Object.fromEntries(count)])\\n                      .map(d => [d.key,{val:d[0][0]}]))\\n\\n  map.set(key, [baseLevel, count])\\n  return map\\n  }, new Map())\\n\\n  //ich habe als base level den max value für jedes ding generiert\\n  // von diesem base level geht es hinab\\n  //\\n\\n  //calculate the max value for each state over all time points\\n  let maxState = alphabet.map(state =>  max([...stateStack.values()]\\n      .map( d =>  d[1].get(state))))\\n      .reduce((acc, cur,i ) =>\\n                acc.concat([ {stacked: acc[i].stacked + cur, count: cur }]), [{stacked: 0, count: 0}])\\n   catSpan = alphabet.map( (d,i) => [ d, maxState[i+1].stacked, maxState[i+1].count, labels[i] ] )\\n\\n  catMap = new Map(yKey.map(t =>\\n          [t, new Map(catSpan.map(d =>\\n          [d[0],\\n          {stacked: d[1], unstacked: d[2]}]))\\n          ])\\n          )\\n\\n  newData = data.map((obj,i) =>\\n  {\\n    obj.index = i;\\n    let d = {...obj};\\n    yKey.map(key =>  d[key] = {\\n      state:d[key],\\n      dense: stateStack.get(key)[0].get(d[key]).stacked++,\\n      time: key, wide: catMap.get(key).get(d[key]).stacked-- - (catMap.get(key).get(d[key]).unstacked - stateStack.get(key)[1].get(d[key]) ) * positionScaler }\\n    )\\n    return d\\n  })\\n\\n\\n}\\n\\nprepareData(data)\\n\\n//check difference\\n// catMap: creates a new Map, with each state as entry;\\n// this map contains a map with the max value in each state\\n// what I need to find is the actual value\\n\\n\\n\\n\\n\\n\\nconst colorMap =\\n  [\\\"#e41a1c\\\",\\n  \\\"#377eb8\\\",\\n  \\\"#4daf4a\\\",\\n  \\\"#984ea3\\\",\\n  \\\"#ff7f00\\\",\\n  \\\"#ffff33\\\",\\n  \\\"#a65628\\\",\\n  \\\"#f781bf\\\"]\\n\\n\\nlet yKeyType = \\\"wide\\\";\\n\\nlet formType = \\\"path\\\" ;\\n\\nlet sortType = \\\"index\\\"\\n\\n\\n$: yDomainMax = max(newData.map(d => yKey.map(key => d[key][yKeyType]) ).flat() );\\n$: yDomain = [ -margins[2],  yDomainMax + margins[0]]\\n\\nlet toggle = true;\\n\\nlet sortOrder;\\n\\nfunction sort() {\\n  console.log(toggle)\\n\\n  let catMap = new Map(yKey.map(d => [d, new Map(catSpan.map(d => [d[0], {val: d[1]}]))]))\\n\\n  toggle ?  sortOrder = data.sort((a,b) => b.order - a.order).map(d => d.id) : sortOrder = data.sort((a,b) => a.order - b.order).map(d => d.id);\\n\\n  let newData = data.sort((a, b) => sortOrder.indexOf(a.id) - sortOrder.indexOf(b.id))\\n      .map((obj,i) =>\\n\\n  {\\n  let d = structuredClone(obj);\\n   yKey.map(key =>  d[key] =  {\\n    state:d[key], dense: stateStack.get(key)[0].get(d[key]).val++ ,time: key, wide: catMap.get(key).get(d[key]).val--}\\n    )\\n  return d\\n  })\\n\\n  console.log(newData[0].id, data[0].id)\\n  //the first entry in the array should equal the first item in the sortOrder\\n  tweenedData.set(newData)\\n  toggle = !toggle\\n\\n}\\n\\n\\n\\n//tween entry one after the other ....\\n\\nconst tweenedData = tweened(newData, {\\n  duration: 1000,\\n  interpolate: (a,b ) => t => {\\n\\n    //hier wird essentiel die ordnung ignoriert\\n    //irgendwie muss im sort befehl eine map gemacht werden, wo die positoion im array dem entspricht\\n    //wo der dings im alten array war und die number angibt, wo er nun im neuen array zu finden ist\\n    //idee: pack ein index in a, sorte a,\\n    //loope dann über b,\\n    //identifiziere a durch den index, update dann den index von b\\n    a.map( (d,i) =>\\n\\n        {\\n          //hier muss man nun irgendwie diese indexOf sache integrieren\\n        yKey.forEach(key =>\\n        {\\n          //hmmmm hm hm wie war das dhier ... a und b sind wieder sortiert\\n          // aber ich gehe nicht mehr über den index sondern über die id\\n          // die id ist gegeben im sortOrder array\\n\\n          let aData = d[key]\\n\\n          let bData = b[sortOrder.indexOf(d.id)][key]\\n          aData.wide = aData.wide + (bData.wide - aData.wide ) * t\\n        });\\n      })\\n\\n      return a;\\n\\n    }\\n})\\n\\n\\n/*\\n   <Svg>\\n      <AxisX/>\\n      {#if formType  == \\\"path\\\"}\\n      <Path />\\n      {/if}\\n      {#if formType  == \\\"rect\\\"}\\n      <Rect />\\n      {/if}\\n      <Annotations {annotations}/>\\n      <AnnotationsLine {annotations}/>\\n\\n    </Svg>\\n*/\\n\\n\\n\\n\\n\\n</script>\\n\\n<style>\\n\\n  .chart-container {\\n    width: 100%;\\n    height: 700px;\\n  }\\n\\n</style>\\n\\n<div class=\\\"chart-container\\\">\\n  <LayerCake\\n    padding={{ top: 20, right: 10, bottom: 20, left: 120 }}\\n    data={$tweenedData}\\n    y = {d => yKey.map(key => {return {x:d[key].time, y:d[key][yKeyType], state:d[key].state  }} ) }\\n    yDomain={yDomain}\\n    xScale={scaleBand()}\\n    xDomain = {yKey}\\n    zScale={scaleOrdinal()}\\n    zDomain = {alphabet}\\n    zRange = {colorMap}\\n  >\\n  <Canvas>\\n    <CanvasController />\\n  </Canvas>\\n  <Svg>\\n    <AxisY tickMarks\\n    snapLabels\\n    gridlines={true} tickMarkLength ={20}\\n    tickGutter ={3}\\n    ticks = {[0].concat(catSpan.map(d => d[1]))}\\n    axisLine = {true}\\n    />\\n\\n    <AxisY\\n    tickMarks = {true}\\n    offSet = {13}\\n    snapLabels\\n    gridlines={false} tickMarkLength ={10}\\n    tickGutter ={25}\\n    tickLabel = {true}\\n    format = { (d,i) => d}\\n    ticks = {catSpan.map(d => d[1] - d[2]*0.5 )}\\n    tickMap = {new Map(catSpan.map(d => [d[1] - d[2]*0.5,d[3]]) )}\\n\\n    />\\n    <AxisX/>\\n  </Svg>\\n</LayerCake>\\n</div>\\n\"],\"names\":[],\"mappings\":\"AAmNE,+BAAiB,CACf,KAAK,CAAE,IAAI,CACX,MAAM,CAAE,KACV\"}"
};

let yKeyType = "wide";

const Stream = create_ssr_component(($$result, $$props, $$bindings, slots) => {
	let yDomainMax;
	let yDomain;
	let $tweenedData, $$unsubscribe_tweenedData;
	let { position } = $$props;
	let { yKey = [] } = $$props;
	let { data = [] } = $$props;
	let { alphabet = [] } = $$props;
	let { cpal = [] } = $$props;
	let { labels = [] } = $$props;
	let { ids = [] } = $$props;
	let { margins = [150, 0, 150, 50] } = $$props;

	// giving the data an id
	//general idea: stacked data layout in wide and dense
	//pass in all x-y stuff
	// give a count value, default: length
	//return the catspan data and stack
	data.forEach((d, i) => d.id = ids[i]);

	let stateStack;
	let newData;
	let catSpan;
	let catMap;
	let positionScaler = position == 'top' ? 0 : position == "bottom" ? 1 : 0.5;

	function prepareData(data) {
		stateStack = yKey.reduce(
			(map, key) => {
				//count counts the occurences of each state for each time
				let count = rollup(data, D => D.length, d => d[key]);

				//include the count stuff as a fourth component
				let baseLevel = new Map(stack().keys(alphabet)([Object.fromEntries(count)]).map(d => [d.key, { val: d[0][0] }]));

				map.set(key, [baseLevel, count]);
				return map;
			},
			new Map()
		);

		//ich habe als base level den max value für jedes ding generiert
		// von diesem base level geht es hinab
		//
		//calculate the max value for each state over all time points
		let maxState = alphabet.map(state => max([...stateStack.values()].map(d => d[1].get(state)))).reduce(
			(acc, cur, i) => acc.concat([
				{
					stacked: acc[i].stacked + cur,
					count: cur
				}
			]),
			[{ stacked: 0, count: 0 }]
		);

		catSpan = alphabet.map((d, i) => [d, maxState[i + 1].stacked, maxState[i + 1].count, labels[i]]);
		catMap = new Map(yKey.map(t => [t, new Map(catSpan.map(d => [d[0], { stacked: d[1], unstacked: d[2] }]))]));

		newData = data.map((obj, i) => {
			obj.index = i;
			let d = { ...obj };

			yKey.map(key => d[key] = {
				state: d[key],
				dense: stateStack.get(key)[0].get(d[key]).stacked++,
				time: key,
				wide: catMap.get(key).get(d[key]).stacked-- - (catMap.get(key).get(d[key]).unstacked - stateStack.get(key)[1].get(d[key])) * positionScaler
			});

			return d;
		});
	}

	prepareData(data);

	//check difference
	// catMap: creates a new Map, with each state as entry;
	// this map contains a map with the max value in each state
	// what I need to find is the actual value
	const colorMap = [
		"#e41a1c",
		"#377eb8",
		"#4daf4a",
		"#984ea3",
		"#ff7f00",
		"#ffff33",
		"#a65628",
		"#f781bf"
	];
	let sortOrder;

	//tween entry one after the other ....
	const tweenedData = tweened(newData, {
		duration: 1000,
		interpolate: (a, b) => t => {
			//hier wird essentiel die ordnung ignoriert
			//irgendwie muss im sort befehl eine map gemacht werden, wo die positoion im array dem entspricht
			//wo der dings im alten array war und die number angibt, wo er nun im neuen array zu finden ist
			//idee: pack ein index in a, sorte a,
			//loope dann über b,
			//identifiziere a durch den index, update dann den index von b
			a.map((d, i) => {
				//hier muss man nun irgendwie diese indexOf sache integrieren
				yKey.forEach(key => {
					//hmmmm hm hm wie war das dhier ... a und b sind wieder sortiert
					// aber ich gehe nicht mehr über den index sondern über die id
					// die id ist gegeben im sortOrder array
					let aData = d[key];

					let bData = b[sortOrder.indexOf(d.id)][key];
					aData.wide = aData.wide + (bData.wide - aData.wide) * t;
				});
			});

			return a;
		}
	});

	$$unsubscribe_tweenedData = subscribe(tweenedData, value => $tweenedData = value);
	if ($$props.position === void 0 && $$bindings.position && position !== void 0) $$bindings.position(position);
	if ($$props.yKey === void 0 && $$bindings.yKey && yKey !== void 0) $$bindings.yKey(yKey);
	if ($$props.data === void 0 && $$bindings.data && data !== void 0) $$bindings.data(data);
	if ($$props.alphabet === void 0 && $$bindings.alphabet && alphabet !== void 0) $$bindings.alphabet(alphabet);
	if ($$props.cpal === void 0 && $$bindings.cpal && cpal !== void 0) $$bindings.cpal(cpal);
	if ($$props.labels === void 0 && $$bindings.labels && labels !== void 0) $$bindings.labels(labels);
	if ($$props.ids === void 0 && $$bindings.ids && ids !== void 0) $$bindings.ids(ids);
	if ($$props.margins === void 0 && $$bindings.margins && margins !== void 0) $$bindings.margins(margins);
	$$result.css.add(css);
	yDomainMax = max(newData.map(d => yKey.map(key => d[key][yKeyType])).flat());
	yDomain = [-margins[2], yDomainMax + margins[0]];
	$$unsubscribe_tweenedData();

	return `<div class="chart-container svelte-1rhinkp">${validate_component(LayerCake, "LayerCake").$$render(
		$$result,
		{
			padding: {
				top: 20,
				right: 10,
				bottom: 20,
				left: 120
			},
			data: $tweenedData,
			y: d => yKey.map(key => {
				return {
					x: d[key].time,
					y: d[key][yKeyType],
					state: d[key].state
				};
			}),
			yDomain,
			xScale: band(),
			xDomain: yKey,
			zScale: ordinal(),
			zDomain: alphabet,
			zRange: colorMap
		},
		{},
		{
			default: () => {
				return `${validate_component(Canvas, "Canvas").$$render($$result, {}, {}, {
					default: () => {
						return `${validate_component(CanvasController, "CanvasController").$$render($$result, {}, {}, {})}`;
					}
				})} ${validate_component(Svg, "Svg").$$render($$result, {}, {}, {
					default: () => {
						return `${validate_component(AxisY, "AxisY").$$render(
							$$result,
							{
								tickMarks: true,
								snapLabels: true,
								gridlines: true,
								tickMarkLength: 20,
								tickGutter: 3,
								ticks: [0].concat(catSpan.map(d => d[1])),
								axisLine: true
							},
							{},
							{}
						)} ${validate_component(AxisY, "AxisY").$$render(
							$$result,
							{
								tickMarks: true,
								offSet: 13,
								snapLabels: true,
								gridlines: false,
								tickMarkLength: 10,
								tickGutter: 25,
								tickLabel: true,
								format: (d, i) => d,
								ticks: catSpan.map(d => d[1] - d[2] * 0.5),
								tickMap: new Map(catSpan.map(d => [d[1] - d[2] * 0.5, d[3]]))
							},
							{},
							{}
						)} ${validate_component(AxisX, "AxisX").$$render($$result, {}, {}, {})}`;
					}
				})}`;
			}
		}
	)}</div>`;
});

module.exports = Stream;
