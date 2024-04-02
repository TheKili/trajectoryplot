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

/** @returns {boolean} */
function is_empty(obj) {
	return Object.keys(obj).length === 0;
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

/** @returns {void} */
function component_subscribe(component, store, callback) {
	component.$$.on_destroy.push(subscribe(store, callback));
}

function create_slot(definition, ctx, $$scope, fn) {
	if (definition) {
		const slot_ctx = get_slot_context(definition, ctx, $$scope, fn);
		return definition[0](slot_ctx);
	}
}

function get_slot_context(definition, ctx, $$scope, fn) {
	return definition[1] && fn ? assign($$scope.ctx.slice(), definition[1](fn(ctx))) : $$scope.ctx;
}

function get_slot_changes(definition, $$scope, dirty, fn) {
	if (definition[2] && fn) {
		const lets = definition[2](fn(dirty));
		if ($$scope.dirty === undefined) {
			return lets;
		}
		if (typeof lets === 'object') {
			const merged = [];
			const len = Math.max($$scope.dirty.length, lets.length);
			for (let i = 0; i < len; i += 1) {
				merged[i] = $$scope.dirty[i] | lets[i];
			}
			return merged;
		}
		return $$scope.dirty | lets;
	}
	return $$scope.dirty;
}

/** @returns {void} */
function update_slot_base(
	slot,
	slot_definition,
	ctx,
	$$scope,
	slot_changes,
	get_slot_context_fn
) {
	if (slot_changes) {
		const slot_context = get_slot_context(slot_definition, ctx, $$scope, get_slot_context_fn);
		slot.p(slot_context, slot_changes);
	}
}

/** @returns {any[] | -1} */
function get_all_dirty_from_scope($$scope) {
	if ($$scope.ctx.length > 32) {
		const dirty = [];
		const length = $$scope.ctx.length / 32;
		for (let i = 0; i < length; i++) {
			dirty[i] = -1;
		}
		return dirty;
	}
	return -1;
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

// Track which nodes are claimed during hydration. Unclaimed nodes can then be removed from the DOM
// at the end of hydration without touching the remaining nodes.
let is_hydrating = false;

/**
 * @returns {void}
 */
function start_hydrating() {
	is_hydrating = true;
}

/**
 * @returns {void}
 */
function end_hydrating() {
	is_hydrating = false;
}

/**
 * @param {number} low
 * @param {number} high
 * @param {(index: number) => number} key
 * @param {number} value
 * @returns {number}
 */
function upper_bound(low, high, key, value) {
	// Return first index of value larger than input value in the range [low, high)
	while (low < high) {
		const mid = low + ((high - low) >> 1);
		if (key(mid) <= value) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	return low;
}

/**
 * @param {NodeEx} target
 * @returns {void}
 */
function init_hydrate(target) {
	if (target.hydrate_init) return;
	target.hydrate_init = true;
	// We know that all children have claim_order values since the unclaimed have been detached if target is not <head>

	let children = /** @type {ArrayLike<NodeEx2>} */ (target.childNodes);
	// If target is <head>, there may be children without claim_order
	if (target.nodeName === 'HEAD') {
		const my_children = [];
		for (let i = 0; i < children.length; i++) {
			const node = children[i];
			if (node.claim_order !== undefined) {
				my_children.push(node);
			}
		}
		children = my_children;
	}
	/*
	 * Reorder claimed children optimally.
	 * We can reorder claimed children optimally by finding the longest subsequence of
	 * nodes that are already claimed in order and only moving the rest. The longest
	 * subsequence of nodes that are claimed in order can be found by
	 * computing the longest increasing subsequence of .claim_order values.
	 *
	 * This algorithm is optimal in generating the least amount of reorder operations
	 * possible.
	 *
	 * Proof:
	 * We know that, given a set of reordering operations, the nodes that do not move
	 * always form an increasing subsequence, since they do not move among each other
	 * meaning that they must be already ordered among each other. Thus, the maximal
	 * set of nodes that do not move form a longest increasing subsequence.
	 */
	// Compute longest increasing subsequence
	// m: subsequence length j => index k of smallest value that ends an increasing subsequence of length j
	const m = new Int32Array(children.length + 1);
	// Predecessor indices + 1
	const p = new Int32Array(children.length);
	m[0] = -1;
	let longest = 0;
	for (let i = 0; i < children.length; i++) {
		const current = children[i].claim_order;
		// Find the largest subsequence length such that it ends in a value less than our current value
		// upper_bound returns first greater value, so we subtract one
		// with fast path for when we are on the current longest subsequence
		const seq_len =
			(longest > 0 && children[m[longest]].claim_order <= current
				? longest + 1
				: upper_bound(1, longest, (idx) => children[m[idx]].claim_order, current)) - 1;
		p[i] = m[seq_len] + 1;
		const new_len = seq_len + 1;
		// We can guarantee that current is the smallest value. Otherwise, we would have generated a longer sequence.
		m[new_len] = i;
		longest = Math.max(new_len, longest);
	}
	// The longest increasing subsequence of nodes (initially reversed)

	/**
	 * @type {NodeEx2[]}
	 */
	const lis = [];
	// The rest of the nodes, nodes that will be moved

	/**
	 * @type {NodeEx2[]}
	 */
	const to_move = [];
	let last = children.length - 1;
	for (let cur = m[longest] + 1; cur != 0; cur = p[cur - 1]) {
		lis.push(children[cur - 1]);
		for (; last >= cur; last--) {
			to_move.push(children[last]);
		}
		last--;
	}
	for (; last >= 0; last--) {
		to_move.push(children[last]);
	}
	lis.reverse();
	// We sort the nodes being moved to guarantee that their insertion order matches the claim order
	to_move.sort((a, b) => a.claim_order - b.claim_order);
	// Finally, we move the nodes
	for (let i = 0, j = 0; i < to_move.length; i++) {
		while (j < lis.length && to_move[i].claim_order >= lis[j].claim_order) {
			j++;
		}
		const anchor = j < lis.length ? lis[j] : null;
		target.insertBefore(to_move[i], anchor);
	}
}

/**
 * @param {Node} target
 * @param {Node} node
 * @returns {void}
 */
function append(target, node) {
	target.appendChild(node);
}

/**
 * @param {Node} target
 * @param {string} style_sheet_id
 * @param {string} styles
 * @returns {void}
 */
function append_styles(target, style_sheet_id, styles) {
	const append_styles_to = get_root_for_style(target);
	if (!append_styles_to.getElementById(style_sheet_id)) {
		const style = element('style');
		style.id = style_sheet_id;
		style.textContent = styles;
		append_stylesheet(append_styles_to, style);
	}
}

/**
 * @param {Node} node
 * @returns {ShadowRoot | Document}
 */
function get_root_for_style(node) {
	if (!node) return document;
	const root = node.getRootNode ? node.getRootNode() : node.ownerDocument;
	if (root && /** @type {ShadowRoot} */ (root).host) {
		return /** @type {ShadowRoot} */ (root);
	}
	return node.ownerDocument;
}

/**
 * @param {ShadowRoot | Document} node
 * @param {HTMLStyleElement} style
 * @returns {CSSStyleSheet}
 */
function append_stylesheet(node, style) {
	append(/** @type {Document} */ (node).head || node, style);
	return style.sheet;
}

/**
 * @param {NodeEx} target
 * @param {NodeEx} node
 * @returns {void}
 */
function append_hydration(target, node) {
	if (is_hydrating) {
		init_hydrate(target);
		if (
			target.actual_end_child === undefined ||
			(target.actual_end_child !== null && target.actual_end_child.parentNode !== target)
		) {
			target.actual_end_child = target.firstChild;
		}
		// Skip nodes of undefined ordering
		while (target.actual_end_child !== null && target.actual_end_child.claim_order === undefined) {
			target.actual_end_child = target.actual_end_child.nextSibling;
		}
		if (node !== target.actual_end_child) {
			// We only insert if the ordering of this node should be modified or the parent node is not target
			if (node.claim_order !== undefined || node.parentNode !== target) {
				target.insertBefore(node, target.actual_end_child);
			}
		} else {
			target.actual_end_child = node.nextSibling;
		}
	} else if (node.parentNode !== target || node.nextSibling !== null) {
		target.appendChild(node);
	}
}

/**
 * @param {NodeEx} target
 * @param {NodeEx} node
 * @param {NodeEx} [anchor]
 * @returns {void}
 */
function insert_hydration(target, node, anchor) {
	if (is_hydrating && !anchor) {
		append_hydration(target, node);
	} else if (node.parentNode !== target || node.nextSibling != anchor) {
		target.insertBefore(node, anchor || null);
	}
}

/**
 * @param {Node} node
 * @returns {void}
 */
function detach(node) {
	if (node.parentNode) {
		node.parentNode.removeChild(node);
	}
}

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} name
 * @returns {HTMLElementTagNameMap[K]}
 */
function element(name) {
	return document.createElement(name);
}

/**
 * @template {keyof SVGElementTagNameMap} K
 * @param {K} name
 * @returns {SVGElement}
 */
function svg_element(name) {
	return document.createElementNS('http://www.w3.org/2000/svg', name);
}

/**
 * @param {string} data
 * @returns {Text}
 */
function text(data) {
	return document.createTextNode(data);
}

/**
 * @returns {Text} */
function space() {
	return text(' ');
}

/**
 * @returns {Text} */
function empty() {
	return text('');
}

/**
 * @param {EventTarget} node
 * @param {string} event
 * @param {EventListenerOrEventListenerObject} handler
 * @param {boolean | AddEventListenerOptions | EventListenerOptions} [options]
 * @returns {() => void}
 */
function listen(node, event, handler, options) {
	node.addEventListener(event, handler, options);
	return () => node.removeEventListener(event, handler, options);
}

/**
 * @param {Element} node
 * @param {string} attribute
 * @param {string} [value]
 * @returns {void}
 */
function attr(node, attribute, value) {
	if (value == null) node.removeAttribute(attribute);
	else if (node.getAttribute(attribute) !== value) node.setAttribute(attribute, value);
}

/**
 * @param {Element} element
 * @returns {ChildNode[]}
 */
function children(element) {
	return Array.from(element.childNodes);
}

/**
 * @param {ChildNodeArray} nodes
 * @returns {void}
 */
function init_claim_info(nodes) {
	if (nodes.claim_info === undefined) {
		nodes.claim_info = { last_index: 0, total_claimed: 0 };
	}
}

/**
 * @template {ChildNodeEx} R
 * @param {ChildNodeArray} nodes
 * @param {(node: ChildNodeEx) => node is R} predicate
 * @param {(node: ChildNodeEx) => ChildNodeEx | undefined} process_node
 * @param {() => R} create_node
 * @param {boolean} dont_update_last_index
 * @returns {R}
 */
function claim_node(nodes, predicate, process_node, create_node, dont_update_last_index = false) {
	// Try to find nodes in an order such that we lengthen the longest increasing subsequence
	init_claim_info(nodes);
	const result_node = (() => {
		// We first try to find an element after the previous one
		for (let i = nodes.claim_info.last_index; i < nodes.length; i++) {
			const node = nodes[i];
			if (predicate(node)) {
				const replacement = process_node(node);
				if (replacement === undefined) {
					nodes.splice(i, 1);
				} else {
					nodes[i] = replacement;
				}
				if (!dont_update_last_index) {
					nodes.claim_info.last_index = i;
				}
				return node;
			}
		}
		// Otherwise, we try to find one before
		// We iterate in reverse so that we don't go too far back
		for (let i = nodes.claim_info.last_index - 1; i >= 0; i--) {
			const node = nodes[i];
			if (predicate(node)) {
				const replacement = process_node(node);
				if (replacement === undefined) {
					nodes.splice(i, 1);
				} else {
					nodes[i] = replacement;
				}
				if (!dont_update_last_index) {
					nodes.claim_info.last_index = i;
				} else if (replacement === undefined) {
					// Since we spliced before the last_index, we decrease it
					nodes.claim_info.last_index--;
				}
				return node;
			}
		}
		// If we can't find any matching node, we create a new one
		return create_node();
	})();
	result_node.claim_order = nodes.claim_info.total_claimed;
	nodes.claim_info.total_claimed += 1;
	return result_node;
}

/**
 * @param {ChildNodeArray} nodes
 * @param {string} name
 * @param {{ [key: string]: boolean }} attributes
 * @param {(name: string) => Element | SVGElement} create_element
 * @returns {Element | SVGElement}
 */
function claim_element_base(nodes, name, attributes, create_element) {
	return claim_node(
		nodes,
		/** @returns {node is Element | SVGElement} */
		(node) => node.nodeName === name,
		/** @param {Element} node */
		(node) => {
			const remove = [];
			for (let j = 0; j < node.attributes.length; j++) {
				const attribute = node.attributes[j];
				if (!attributes[attribute.name]) {
					remove.push(attribute.name);
				}
			}
			remove.forEach((v) => node.removeAttribute(v));
			return undefined;
		},
		() => create_element(name)
	);
}

/**
 * @param {ChildNodeArray} nodes
 * @param {string} name
 * @param {{ [key: string]: boolean }} attributes
 * @returns {Element | SVGElement}
 */
function claim_element(nodes, name, attributes) {
	return claim_element_base(nodes, name, attributes, element);
}

/**
 * @param {ChildNodeArray} nodes
 * @param {string} name
 * @param {{ [key: string]: boolean }} attributes
 * @returns {Element | SVGElement}
 */
function claim_svg_element(nodes, name, attributes) {
	return claim_element_base(nodes, name, attributes, svg_element);
}

/**
 * @param {ChildNodeArray} nodes
 * @returns {Text}
 */
function claim_text(nodes, data) {
	return claim_node(
		nodes,
		/** @returns {node is Text} */
		(node) => node.nodeType === 3,
		/** @param {Text} node */
		(node) => {
			const data_str = '' + data;
			if (node.data.startsWith(data_str)) {
				if (node.data.length !== data_str.length) {
					return node.splitText(data_str.length);
				}
			} else {
				node.data = data_str;
			}
		},
		() => text(data),
		true // Text nodes should not update last index since it is likely not worth it to eliminate an increasing subsequence of actual elements
	);
}

/**
 * @returns {Text} */
function claim_space(nodes) {
	return claim_text(nodes, ' ');
}

/**
 * @param {Text} text
 * @param {unknown} data
 * @returns {void}
 */
function set_data(text, data) {
	data = '' + data;
	if (text.data === data) return;
	text.data = /** @type {string} */ (data);
}

/**
 * @returns {void} */
function set_style(node, key, value, important) {
	if (value == null) {
		node.style.removeProperty(key);
	} else {
		node.style.setProperty(key, value, important ? 'important' : '');
	}
}
// unfortunately this can't be a constant as that wouldn't be tree-shakeable
// so we cache the result instead

/**
 * @type {boolean} */
let crossorigin;

/**
 * @returns {boolean} */
function is_crossorigin() {
	if (crossorigin === undefined) {
		crossorigin = false;
		try {
			if (typeof window !== 'undefined' && window.parent) {
				void window.parent.document;
			}
		} catch (error) {
			crossorigin = true;
		}
	}
	return crossorigin;
}

/**
 * @param {HTMLElement} node
 * @param {() => void} fn
 * @returns {() => void}
 */
function add_iframe_resize_listener(node, fn) {
	const computed_style = getComputedStyle(node);
	if (computed_style.position === 'static') {
		node.style.position = 'relative';
	}
	const iframe = element('iframe');
	iframe.setAttribute(
		'style',
		'display: block; position: absolute; top: 0; left: 0; width: 100%; height: 100%; ' +
			'overflow: hidden; border: 0; opacity: 0; pointer-events: none; z-index: -1;'
	);
	iframe.setAttribute('aria-hidden', 'true');
	iframe.tabIndex = -1;
	const crossorigin = is_crossorigin();

	/**
	 * @type {() => void}
	 */
	let unsubscribe;
	if (crossorigin) {
		iframe.src = "data:text/html,<script>onresize=function(){parent.postMessage(0,'*')}</script>";
		unsubscribe = listen(
			window,
			'message',
			/** @param {MessageEvent} event */ (event) => {
				if (event.source === iframe.contentWindow) fn();
			}
		);
	} else {
		iframe.src = 'about:blank';
		iframe.onload = () => {
			unsubscribe = listen(iframe.contentWindow, 'resize', fn);
			// make sure an initial resize event is fired _after_ the iframe is loaded (which is asynchronous)
			// see https://github.com/sveltejs/svelte/issues/4233
			fn();
		};
	}
	append(node, iframe);
	return () => {
		if (crossorigin) {
			unsubscribe();
		} else if (unsubscribe && iframe.contentWindow) {
			unsubscribe();
		}
		detach(iframe);
	};
}

/**
 * @returns {void} */
function toggle_class(element, name, toggle) {
	// The `!!` is required because an `undefined` flag means flipping the current state.
	element.classList.toggle(name, !!toggle);
}

/**
 * @typedef {Node & {
 * 	claim_order?: number;
 * 	hydrate_init?: true;
 * 	actual_end_child?: NodeEx;
 * 	childNodes: NodeListOf<NodeEx>;
 * }} NodeEx
 */

/** @typedef {ChildNode & NodeEx} ChildNodeEx */

/** @typedef {NodeEx & { claim_order: number }} NodeEx2 */

/**
 * @typedef {ChildNodeEx[] & {
 * 	claim_info?: {
 * 		last_index: number;
 * 		total_claimed: number;
 * 	};
 * }} ChildNodeArray
 */

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
 * The `onMount` function schedules a callback to run as soon as the component has been mounted to the DOM.
 * It must be called during the component's initialisation (but doesn't need to live *inside* the component;
 * it can be called from an external module).
 *
 * If a function is returned _synchronously_ from `onMount`, it will be called when the component is unmounted.
 *
 * `onMount` does not run inside a [server-side component](/docs#run-time-server-side-component-api).
 *
 * https://svelte.dev/docs/svelte#onmount
 * @template T
 * @param {() => import('./private.js').NotFunction<T> | Promise<import('./private.js').NotFunction<T>> | (() => any)} fn
 * @returns {void}
 */
function onMount(fn) {
	get_current_component().$$.on_mount.push(fn);
}

/**
 * Schedules a callback to run immediately after the component has been updated.
 *
 * The first time the callback runs will be after the initial `onMount`
 *
 * https://svelte.dev/docs/svelte#afterupdate
 * @param {() => any} fn
 * @returns {void}
 */
function afterUpdate(fn) {
	get_current_component().$$.after_update.push(fn);
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

const dirty_components = [];
const binding_callbacks = [];

let render_callbacks = [];

const flush_callbacks = [];

const resolved_promise = /* @__PURE__ */ Promise.resolve();

let update_scheduled = false;

/** @returns {void} */
function schedule_update() {
	if (!update_scheduled) {
		update_scheduled = true;
		resolved_promise.then(flush);
	}
}

/** @returns {Promise<void>} */
function tick() {
	schedule_update();
	return resolved_promise;
}

/** @returns {void} */
function add_render_callback(fn) {
	render_callbacks.push(fn);
}

// flush() calls callbacks in this order:
// 1. All beforeUpdate callbacks, in order: parents before children
// 2. All bind:this callbacks, in reverse order: children before parents.
// 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
//    for afterUpdates called during the initial onMount, which are called in
//    reverse order: children before parents.
// Since callbacks might update component values, which could trigger another
// call to flush(), the following steps guard against this:
// 1. During beforeUpdate, any updated components will be added to the
//    dirty_components array and will cause a reentrant call to flush(). Because
//    the flush index is kept outside the function, the reentrant call will pick
//    up where the earlier call left off and go through all dirty components. The
//    current_component value is saved and restored so that the reentrant call will
//    not interfere with the "parent" flush() call.
// 2. bind:this callbacks cannot trigger new flush() calls.
// 3. During afterUpdate, any updated components will NOT have their afterUpdate
//    callback called a second time; the seen_callbacks set, outside the flush()
//    function, guarantees this behavior.
const seen_callbacks = new Set();

let flushidx = 0; // Do *not* move this inside the flush() function

/** @returns {void} */
function flush() {
	// Do not reenter flush while dirty components are updated, as this can
	// result in an infinite loop. Instead, let the inner flush handle it.
	// Reentrancy is ok afterwards for bindings etc.
	if (flushidx !== 0) {
		return;
	}
	const saved_component = current_component;
	do {
		// first, call beforeUpdate functions
		// and update components
		try {
			while (flushidx < dirty_components.length) {
				const component = dirty_components[flushidx];
				flushidx++;
				set_current_component(component);
				update(component.$$);
			}
		} catch (e) {
			// reset dirty state to not end up in a deadlocked state and then rethrow
			dirty_components.length = 0;
			flushidx = 0;
			throw e;
		}
		set_current_component(null);
		dirty_components.length = 0;
		flushidx = 0;
		while (binding_callbacks.length) binding_callbacks.pop()();
		// then, once components are updated, call
		// afterUpdate functions. This may cause
		// subsequent updates...
		for (let i = 0; i < render_callbacks.length; i += 1) {
			const callback = render_callbacks[i];
			if (!seen_callbacks.has(callback)) {
				// ...so guard against infinite loops
				seen_callbacks.add(callback);
				callback();
			}
		}
		render_callbacks.length = 0;
	} while (dirty_components.length);
	while (flush_callbacks.length) {
		flush_callbacks.pop()();
	}
	update_scheduled = false;
	seen_callbacks.clear();
	set_current_component(saved_component);
}

/** @returns {void} */
function update($$) {
	if ($$.fragment !== null) {
		$$.update();
		run_all($$.before_update);
		const dirty = $$.dirty;
		$$.dirty = [-1];
		$$.fragment && $$.fragment.p($$.ctx, dirty);
		$$.after_update.forEach(add_render_callback);
	}
}

/**
 * Useful for example to execute remaining `afterUpdate` callbacks before executing `destroy`.
 * @param {Function[]} fns
 * @returns {void}
 */
function flush_render_callbacks(fns) {
	const filtered = [];
	const targets = [];
	render_callbacks.forEach((c) => (fns.indexOf(c) === -1 ? filtered.push(c) : targets.push(c)));
	targets.forEach((c) => c());
	render_callbacks = filtered;
}

const outroing = new Set();

/**
 * @type {Outro}
 */
let outros;

/**
 * @returns {void} */
function group_outros() {
	outros = {
		r: 0,
		c: [],
		p: outros // parent group
	};
}

/**
 * @returns {void} */
function check_outros() {
	if (!outros.r) {
		run_all(outros.c);
	}
	outros = outros.p;
}

/**
 * @param {import('./private.js').Fragment} block
 * @param {0 | 1} [local]
 * @returns {void}
 */
function transition_in(block, local) {
	if (block && block.i) {
		outroing.delete(block);
		block.i(local);
	}
}

/**
 * @param {import('./private.js').Fragment} block
 * @param {0 | 1} local
 * @param {0 | 1} [detach]
 * @param {() => void} [callback]
 * @returns {void}
 */
function transition_out(block, local, detach, callback) {
	if (block && block.o) {
		if (outroing.has(block)) return;
		outroing.add(block);
		outros.c.push(() => {
			outroing.delete(block);
			if (callback) {
				if (detach) block.d(1);
				callback();
			}
		});
		block.o(local);
	} else if (callback) {
		callback();
	}
}

/** @typedef {1} INTRO */
/** @typedef {0} OUTRO */
/** @typedef {{ direction: 'in' | 'out' | 'both' }} TransitionOptions */
/** @typedef {(node: Element, params: any, options: TransitionOptions) => import('../transition/public.js').TransitionConfig} TransitionFn */

/**
 * @typedef {Object} Outro
 * @property {number} r
 * @property {Function[]} c
 * @property {Object} p
 */

/**
 * @typedef {Object} PendingProgram
 * @property {number} start
 * @property {INTRO|OUTRO} b
 * @property {Outro} [group]
 */

/**
 * @typedef {Object} Program
 * @property {number} a
 * @property {INTRO|OUTRO} b
 * @property {1|-1} d
 * @property {number} duration
 * @property {number} start
 * @property {number} end
 * @property {Outro} [group]
 */

// general each functions:

function ensure_array_like(array_like_or_iterator) {
	return array_like_or_iterator?.length !== undefined
		? array_like_or_iterator
		: Array.from(array_like_or_iterator);
}

// keyed each functions:

/** @returns {void} */
function destroy_block(block, lookup) {
	block.d(1);
	lookup.delete(block.key);
}

/** @returns {void} */
function outro_and_destroy_block(block, lookup) {
	transition_out(block, 1, 1, () => {
		lookup.delete(block.key);
	});
}

/** @returns {any[]} */
function update_keyed_each(
	old_blocks,
	dirty,
	get_key,
	dynamic,
	ctx,
	list,
	lookup,
	node,
	destroy,
	create_each_block,
	next,
	get_context
) {
	let o = old_blocks.length;
	let n = list.length;
	let i = o;
	const old_indexes = {};
	while (i--) old_indexes[old_blocks[i].key] = i;
	const new_blocks = [];
	const new_lookup = new Map();
	const deltas = new Map();
	const updates = [];
	i = n;
	while (i--) {
		const child_ctx = get_context(ctx, list, i);
		const key = get_key(child_ctx);
		let block = lookup.get(key);
		if (!block) {
			block = create_each_block(key, child_ctx);
			block.c();
		} else if (dynamic) {
			// defer updates until all the DOM shuffling is done
			updates.push(() => block.p(child_ctx, dirty));
		}
		new_lookup.set(key, (new_blocks[i] = block));
		if (key in old_indexes) deltas.set(key, Math.abs(i - old_indexes[key]));
	}
	const will_move = new Set();
	const did_move = new Set();
	/** @returns {void} */
	function insert(block) {
		transition_in(block, 1);
		block.m(node, next);
		lookup.set(block.key, block);
		next = block.first;
		n--;
	}
	while (o && n) {
		const new_block = new_blocks[n - 1];
		const old_block = old_blocks[o - 1];
		const new_key = new_block.key;
		const old_key = old_block.key;
		if (new_block === old_block) {
			// do nothing
			next = new_block.first;
			o--;
			n--;
		} else if (!new_lookup.has(old_key)) {
			// remove old block
			destroy(old_block, lookup);
			o--;
		} else if (!lookup.has(new_key) || will_move.has(new_key)) {
			insert(new_block);
		} else if (did_move.has(old_key)) {
			o--;
		} else if (deltas.get(new_key) > deltas.get(old_key)) {
			did_move.add(new_key);
			insert(new_block);
		} else {
			will_move.add(old_key);
			o--;
		}
	}
	while (o--) {
		const old_block = old_blocks[o];
		if (!new_lookup.has(old_block.key)) destroy(old_block, lookup);
	}
	while (n) insert(new_blocks[n - 1]);
	run_all(updates);
	return new_blocks;
}

/** @returns {void} */
function create_component(block) {
	block && block.c();
}

/** @returns {void} */
function claim_component(block, parent_nodes) {
	block && block.l(parent_nodes);
}

/** @returns {void} */
function mount_component(component, target, anchor) {
	const { fragment, after_update } = component.$$;
	fragment && fragment.m(target, anchor);
	// onMount happens before the initial afterUpdate
	add_render_callback(() => {
		const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
		// if the component was destroyed immediately
		// it will update the `$$.on_destroy` reference to `null`.
		// the destructured on_destroy may still reference to the old array
		if (component.$$.on_destroy) {
			component.$$.on_destroy.push(...new_on_destroy);
		} else {
			// Edge case - component was destroyed immediately,
			// most likely as a result of a binding initialising
			run_all(new_on_destroy);
		}
		component.$$.on_mount = [];
	});
	after_update.forEach(add_render_callback);
}

/** @returns {void} */
function destroy_component(component, detaching) {
	const $$ = component.$$;
	if ($$.fragment !== null) {
		flush_render_callbacks($$.after_update);
		run_all($$.on_destroy);
		$$.fragment && $$.fragment.d(detaching);
		// TODO null out other refs, including component.$$ (but need to
		// preserve final state?)
		$$.on_destroy = $$.fragment = null;
		$$.ctx = [];
	}
}

/** @returns {void} */
function make_dirty(component, i) {
	if (component.$$.dirty[0] === -1) {
		dirty_components.push(component);
		schedule_update();
		component.$$.dirty.fill(0);
	}
	component.$$.dirty[(i / 31) | 0] |= 1 << i % 31;
}

// TODO: Document the other params
/**
 * @param {SvelteComponent} component
 * @param {import('./public.js').ComponentConstructorOptions} options
 *
 * @param {import('./utils.js')['not_equal']} not_equal Used to compare props and state values.
 * @param {(target: Element | ShadowRoot) => void} [append_styles] Function that appends styles to the DOM when the component is first initialised.
 * This will be the `add_css` function from the compiled component.
 *
 * @returns {void}
 */
function init(
	component,
	options,
	instance,
	create_fragment,
	not_equal,
	props,
	append_styles = null,
	dirty = [-1]
) {
	const parent_component = current_component;
	set_current_component(component);
	/** @type {import('./private.js').T$$} */
	const $$ = (component.$$ = {
		fragment: null,
		ctx: [],
		// state
		props,
		update: noop,
		not_equal,
		bound: blank_object(),
		// lifecycle
		on_mount: [],
		on_destroy: [],
		on_disconnect: [],
		before_update: [],
		after_update: [],
		context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
		// everything else
		callbacks: blank_object(),
		dirty,
		skip_bound: false,
		root: options.target || parent_component.$$.root
	});
	append_styles && append_styles($$.root);
	let ready = false;
	$$.ctx = instance
		? instance(component, options.props || {}, (i, ret, ...rest) => {
				const value = rest.length ? rest[0] : ret;
				if ($$.ctx && not_equal($$.ctx[i], ($$.ctx[i] = value))) {
					if (!$$.skip_bound && $$.bound[i]) $$.bound[i](value);
					if (ready) make_dirty(component, i);
				}
				return ret;
		  })
		: [];
	$$.update();
	ready = true;
	run_all($$.before_update);
	// `false` as a special case of no DOM component
	$$.fragment = create_fragment ? create_fragment($$.ctx) : false;
	if (options.target) {
		if (options.hydrate) {
			start_hydrating();
			// TODO: what is the correct type here?
			// @ts-expect-error
			const nodes = children(options.target);
			$$.fragment && $$.fragment.l(nodes);
			nodes.forEach(detach);
		} else {
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			$$.fragment && $$.fragment.c();
		}
		if (options.intro) transition_in(component.$$.fragment);
		mount_component(component, options.target, options.anchor);
		end_hydrating();
		flush();
	}
	set_current_component(parent_component);
}

/**
 * Base class for Svelte components. Used when dev=false.
 *
 * @template {Record<string, any>} [Props=any]
 * @template {Record<string, any>} [Events=any]
 */
class SvelteComponent {
	/**
	 * ### PRIVATE API
	 *
	 * Do not use, may change at any time
	 *
	 * @type {any}
	 */
	$$ = undefined;
	/**
	 * ### PRIVATE API
	 *
	 * Do not use, may change at any time
	 *
	 * @type {any}
	 */
	$$set = undefined;

	/** @returns {void} */
	$destroy() {
		destroy_component(this, 1);
		this.$destroy = noop;
	}

	/**
	 * @template {Extract<keyof Events, string>} K
	 * @param {K} type
	 * @param {((e: Events[K]) => void) | null | undefined} callback
	 * @returns {() => void}
	 */
	$on(type, callback) {
		if (!is_function(callback)) {
			return noop;
		}
		const callbacks = this.$$.callbacks[type] || (this.$$.callbacks[type] = []);
		callbacks.push(callback);
		return () => {
			const index = callbacks.indexOf(callback);
			if (index !== -1) callbacks.splice(index, 1);
		};
	}

	/**
	 * @param {Partial<Props>} props
	 * @returns {void}
	 */
	$set(props) {
		if (this.$$set && !is_empty(props)) {
			this.$$.skip_bound = true;
			this.$$set(props);
			this.$$.skip_bound = false;
		}
	}
}

/**
 * @typedef {Object} CustomElementPropDefinition
 * @property {string} [attribute]
 * @property {boolean} [reflect]
 * @property {'String'|'Boolean'|'Number'|'Array'|'Object'} [type]
 */

// generated during release, do not modify

const PUBLIC_VERSION = '4';

if (typeof window !== 'undefined')
	// @ts-ignore
	(window.__svelte || (window.__svelte = { v: new Set() })).v.add(PUBLIC_VERSION);

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

function add_css$4(target) {
	append_styles(target, "svelte-vhzpsp", ".layercake-container.svelte-vhzpsp,.layercake-container.svelte-vhzpsp *{box-sizing:border-box}.layercake-container.svelte-vhzpsp{width:100%;height:100%}");
}

const get_default_slot_changes$3 = dirty => ({
	element: dirty[0] & /*element*/ 4,
	width: dirty[1] & /*$width_d*/ 8,
	height: dirty[1] & /*$height_d*/ 16,
	aspectRatio: dirty[1] & /*$aspectRatio_d*/ 32,
	containerWidth: dirty[1] & /*$_containerWidth*/ 2,
	containerHeight: dirty[1] & /*$_containerHeight*/ 1,
	activeGetters: dirty[0] & /*$activeGetters_d*/ 1024,
	percentRange: dirty[1] & /*$_percentRange*/ 4,
	x: dirty[0] & /*$_x*/ 268435456,
	y: dirty[0] & /*$_y*/ 134217728,
	z: dirty[0] & /*$_z*/ 67108864,
	r: dirty[0] & /*$_r*/ 33554432,
	custom: dirty[0] & /*$_custom*/ 4096,
	data: dirty[0] & /*$_data*/ 1073741824,
	xNice: dirty[0] & /*$_xNice*/ 16777216,
	yNice: dirty[0] & /*$_yNice*/ 8388608,
	zNice: dirty[0] & /*$_zNice*/ 4194304,
	rNice: dirty[0] & /*$_rNice*/ 2097152,
	xReverse: dirty[0] & /*$_xReverse*/ 1048576,
	yReverse: dirty[0] & /*$_yReverse*/ 524288,
	zReverse: dirty[0] & /*$_zReverse*/ 262144,
	rReverse: dirty[0] & /*$_rReverse*/ 131072,
	xPadding: dirty[0] & /*$_xPadding*/ 65536,
	yPadding: dirty[0] & /*$_yPadding*/ 32768,
	zPadding: dirty[0] & /*$_zPadding*/ 16384,
	rPadding: dirty[0] & /*$_rPadding*/ 8192,
	padding: dirty[1] & /*$padding_d*/ 64,
	flatData: dirty[0] & /*$_flatData*/ 536870912,
	extents: dirty[1] & /*$extents_d*/ 128,
	xDomain: dirty[1] & /*$xDomain_d*/ 256,
	yDomain: dirty[1] & /*$yDomain_d*/ 512,
	zDomain: dirty[1] & /*$zDomain_d*/ 1024,
	rDomain: dirty[1] & /*$rDomain_d*/ 2048,
	xRange: dirty[1] & /*$xRange_d*/ 4096,
	yRange: dirty[1] & /*$yRange_d*/ 8192,
	zRange: dirty[1] & /*$zRange_d*/ 16384,
	rRange: dirty[1] & /*$rRange_d*/ 32768,
	config: dirty[0] & /*$_config*/ 2048,
	xScale: dirty[0] & /*$xScale_d*/ 512,
	xGet: dirty[1] & /*$xGet_d*/ 65536,
	yScale: dirty[0] & /*$yScale_d*/ 256,
	yGet: dirty[1] & /*$yGet_d*/ 131072,
	zScale: dirty[0] & /*$zScale_d*/ 128,
	zGet: dirty[1] & /*$zGet_d*/ 262144,
	rScale: dirty[0] & /*$rScale_d*/ 64,
	rGet: dirty[1] & /*$rGet_d*/ 524288
});

const get_default_slot_context$3 = ctx => ({
	element: /*element*/ ctx[2],
	width: /*$width_d*/ ctx[34],
	height: /*$height_d*/ ctx[35],
	aspectRatio: /*$aspectRatio_d*/ ctx[36],
	containerWidth: /*$_containerWidth*/ ctx[32],
	containerHeight: /*$_containerHeight*/ ctx[31],
	activeGetters: /*$activeGetters_d*/ ctx[10],
	percentRange: /*$_percentRange*/ ctx[33],
	x: /*$_x*/ ctx[28],
	y: /*$_y*/ ctx[27],
	z: /*$_z*/ ctx[26],
	r: /*$_r*/ ctx[25],
	custom: /*$_custom*/ ctx[12],
	data: /*$_data*/ ctx[30],
	xNice: /*$_xNice*/ ctx[24],
	yNice: /*$_yNice*/ ctx[23],
	zNice: /*$_zNice*/ ctx[22],
	rNice: /*$_rNice*/ ctx[21],
	xReverse: /*$_xReverse*/ ctx[20],
	yReverse: /*$_yReverse*/ ctx[19],
	zReverse: /*$_zReverse*/ ctx[18],
	rReverse: /*$_rReverse*/ ctx[17],
	xPadding: /*$_xPadding*/ ctx[16],
	yPadding: /*$_yPadding*/ ctx[15],
	zPadding: /*$_zPadding*/ ctx[14],
	rPadding: /*$_rPadding*/ ctx[13],
	padding: /*$padding_d*/ ctx[37],
	flatData: /*$_flatData*/ ctx[29],
	extents: /*$extents_d*/ ctx[38],
	xDomain: /*$xDomain_d*/ ctx[39],
	yDomain: /*$yDomain_d*/ ctx[40],
	zDomain: /*$zDomain_d*/ ctx[41],
	rDomain: /*$rDomain_d*/ ctx[42],
	xRange: /*$xRange_d*/ ctx[43],
	yRange: /*$yRange_d*/ ctx[44],
	zRange: /*$zRange_d*/ ctx[45],
	rRange: /*$rRange_d*/ ctx[46],
	config: /*$_config*/ ctx[11],
	xScale: /*$xScale_d*/ ctx[9],
	xGet: /*$xGet_d*/ ctx[47],
	yScale: /*$yScale_d*/ ctx[8],
	yGet: /*$yGet_d*/ ctx[48],
	zScale: /*$zScale_d*/ ctx[7],
	zGet: /*$zGet_d*/ ctx[49],
	rScale: /*$rScale_d*/ ctx[6],
	rGet: /*$rGet_d*/ ctx[50]
});

// (469:0) {#if ssr === true || typeof window !== 'undefined'}
function create_if_block$5(ctx) {
	let div;
	let div_resize_listener;
	let current;
	const default_slot_template = /*#slots*/ ctx[153].default;
	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[152], get_default_slot_context$3);

	return {
		c() {
			div = element("div");
			if (default_slot) default_slot.c();
			this.h();
		},
		l(nodes) {
			div = claim_element(nodes, "DIV", { class: true });
			var div_nodes = children(div);
			if (default_slot) default_slot.l(div_nodes);
			div_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(div, "class", "layercake-container svelte-vhzpsp");
			add_render_callback(() => /*div_elementresize_handler*/ ctx[155].call(div));
			set_style(div, "position", /*position*/ ctx[5]);
			set_style(div, "top", /*position*/ ctx[5] === 'absolute' ? '0' : null);
			set_style(div, "right", /*position*/ ctx[5] === 'absolute' ? '0' : null);
			set_style(div, "bottom", /*position*/ ctx[5] === 'absolute' ? '0' : null);
			set_style(div, "left", /*position*/ ctx[5] === 'absolute' ? '0' : null);
			set_style(div, "pointer-events", /*pointerEvents*/ ctx[4] === false ? 'none' : null);
		},
		m(target, anchor) {
			insert_hydration(target, div, anchor);

			if (default_slot) {
				default_slot.m(div, null);
			}

			/*div_binding*/ ctx[154](div);
			div_resize_listener = add_iframe_resize_listener(div, /*div_elementresize_handler*/ ctx[155].bind(div));
			current = true;
		},
		p(ctx, dirty) {
			if (default_slot) {
				if (default_slot.p && (!current || dirty[0] & /*element, $activeGetters_d, $_x, $_y, $_z, $_r, $_custom, $_data, $_xNice, $_yNice, $_zNice, $_rNice, $_xReverse, $_yReverse, $_zReverse, $_rReverse, $_xPadding, $_yPadding, $_zPadding, $_rPadding, $_flatData, $_config, $xScale_d, $yScale_d, $zScale_d, $rScale_d*/ 2147483588 | dirty[1] & /*$width_d, $height_d, $aspectRatio_d, $_containerWidth, $_containerHeight, $_percentRange, $padding_d, $extents_d, $xDomain_d, $yDomain_d, $zDomain_d, $rDomain_d, $xRange_d, $yRange_d, $zRange_d, $rRange_d, $xGet_d, $yGet_d, $zGet_d, $rGet_d*/ 1048575 | dirty[4] & /*$$scope*/ 268435456)) {
					update_slot_base(
						default_slot,
						default_slot_template,
						ctx,
						/*$$scope*/ ctx[152],
						!current
						? get_all_dirty_from_scope(/*$$scope*/ ctx[152])
						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[152], dirty, get_default_slot_changes$3),
						get_default_slot_context$3
					);
				}
			}

			if (dirty[0] & /*position*/ 32) {
				set_style(div, "position", /*position*/ ctx[5]);
			}

			if (dirty[0] & /*position*/ 32) {
				set_style(div, "top", /*position*/ ctx[5] === 'absolute' ? '0' : null);
			}

			if (dirty[0] & /*position*/ 32) {
				set_style(div, "right", /*position*/ ctx[5] === 'absolute' ? '0' : null);
			}

			if (dirty[0] & /*position*/ 32) {
				set_style(div, "bottom", /*position*/ ctx[5] === 'absolute' ? '0' : null);
			}

			if (dirty[0] & /*position*/ 32) {
				set_style(div, "left", /*position*/ ctx[5] === 'absolute' ? '0' : null);
			}

			if (dirty[0] & /*pointerEvents*/ 16) {
				set_style(div, "pointer-events", /*pointerEvents*/ ctx[4] === false ? 'none' : null);
			}
		},
		i(local) {
			if (current) return;
			transition_in(default_slot, local);
			current = true;
		},
		o(local) {
			transition_out(default_slot, local);
			current = false;
		},
		d(detaching) {
			if (detaching) {
				detach(div);
			}

			if (default_slot) default_slot.d(detaching);
			/*div_binding*/ ctx[154](null);
			div_resize_listener();
		}
	};
}

function create_fragment$7(ctx) {
	let if_block_anchor;
	let current;
	let if_block = (/*ssr*/ ctx[3] === true || typeof window !== 'undefined') && create_if_block$5(ctx);

	return {
		c() {
			if (if_block) if_block.c();
			if_block_anchor = empty();
		},
		l(nodes) {
			if (if_block) if_block.l(nodes);
			if_block_anchor = empty();
		},
		m(target, anchor) {
			if (if_block) if_block.m(target, anchor);
			insert_hydration(target, if_block_anchor, anchor);
			current = true;
		},
		p(ctx, dirty) {
			if (/*ssr*/ ctx[3] === true || typeof window !== 'undefined') {
				if (if_block) {
					if_block.p(ctx, dirty);

					if (dirty[0] & /*ssr*/ 8) {
						transition_in(if_block, 1);
					}
				} else {
					if_block = create_if_block$5(ctx);
					if_block.c();
					transition_in(if_block, 1);
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			} else if (if_block) {
				group_outros();

				transition_out(if_block, 1, 1, () => {
					if_block = null;
				});

				check_outros();
			}
		},
		i(local) {
			if (current) return;
			transition_in(if_block);
			current = true;
		},
		o(local) {
			transition_out(if_block);
			current = false;
		},
		d(detaching) {
			if (detaching) {
				detach(if_block_anchor);
			}

			if (if_block) if_block.d(detaching);
		}
	};
}

function instance$8($$self, $$props, $$invalidate) {
	let yReverseValue;
	let context;
	let $rScale_d;
	let $zScale_d;
	let $yScale_d;
	let $xScale_d;
	let $activeGetters_d;
	let $box_d;
	let $_config;
	let $_custom;
	let $_rScale;
	let $_zScale;
	let $_yScale;
	let $_xScale;
	let $_rRange;
	let $_zRange;
	let $_yRange;
	let $_xRange;
	let $_rPadding;
	let $_zPadding;
	let $_yPadding;
	let $_xPadding;
	let $_rReverse;
	let $_zReverse;
	let $_yReverse;
	let $_xReverse;
	let $_rNice;
	let $_zNice;
	let $_yNice;
	let $_xNice;
	let $_rDomain;
	let $_zDomain;
	let $_yDomain;
	let $_xDomain;
	let $_r;
	let $_z;
	let $_y;
	let $_x;
	let $_padding;
	let $_flatData;
	let $_data;
	let $_extents;
	let $_containerHeight;
	let $_containerWidth;
	let $_percentRange;
	let $width_d;
	let $height_d;
	let $aspectRatio_d;
	let $padding_d;
	let $extents_d;
	let $xDomain_d;
	let $yDomain_d;
	let $zDomain_d;
	let $rDomain_d;
	let $xRange_d;
	let $yRange_d;
	let $zRange_d;
	let $rRange_d;
	let $xGet_d;
	let $yGet_d;
	let $zGet_d;
	let $rGet_d;
	let { $$slots: slots = {}, $$scope } = $$props;
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

	onMount(() => {
		isMounted = true;
	});

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

	component_subscribe($$self, _percentRange, value => $$invalidate(33, $_percentRange = value));
	const _containerWidth = writable(containerWidth);
	component_subscribe($$self, _containerWidth, value => $$invalidate(32, $_containerWidth = value));
	const _containerHeight = writable(containerHeight);
	component_subscribe($$self, _containerHeight, value => $$invalidate(31, $_containerHeight = value));
	const _extents = writable(filterObject(extents));
	component_subscribe($$self, _extents, value => $$invalidate(170, $_extents = value));
	const _data = writable(data);
	component_subscribe($$self, _data, value => $$invalidate(30, $_data = value));
	const _flatData = writable(flatData || data);
	component_subscribe($$self, _flatData, value => $$invalidate(29, $_flatData = value));
	const _padding = writable(padding);
	component_subscribe($$self, _padding, value => $$invalidate(169, $_padding = value));
	const _x = writable(makeAccessor(x));
	component_subscribe($$self, _x, value => $$invalidate(28, $_x = value));
	const _y = writable(makeAccessor(y));
	component_subscribe($$self, _y, value => $$invalidate(27, $_y = value));
	const _z = writable(makeAccessor(z));
	component_subscribe($$self, _z, value => $$invalidate(26, $_z = value));
	const _r = writable(makeAccessor(r));
	component_subscribe($$self, _r, value => $$invalidate(25, $_r = value));
	const _xDomain = writable(xDomain);
	component_subscribe($$self, _xDomain, value => $$invalidate(168, $_xDomain = value));
	const _yDomain = writable(yDomain);
	component_subscribe($$self, _yDomain, value => $$invalidate(167, $_yDomain = value));
	const _zDomain = writable(zDomain);
	component_subscribe($$self, _zDomain, value => $$invalidate(166, $_zDomain = value));
	const _rDomain = writable(rDomain);
	component_subscribe($$self, _rDomain, value => $$invalidate(165, $_rDomain = value));
	const _xNice = writable(xNice);
	component_subscribe($$self, _xNice, value => $$invalidate(24, $_xNice = value));
	const _yNice = writable(yNice);
	component_subscribe($$self, _yNice, value => $$invalidate(23, $_yNice = value));
	const _zNice = writable(zNice);
	component_subscribe($$self, _zNice, value => $$invalidate(22, $_zNice = value));
	const _rNice = writable(rNice);
	component_subscribe($$self, _rNice, value => $$invalidate(21, $_rNice = value));
	const _xReverse = writable(xReverse);
	component_subscribe($$self, _xReverse, value => $$invalidate(20, $_xReverse = value));
	const _yReverse = writable(yReverseValue);
	component_subscribe($$self, _yReverse, value => $$invalidate(19, $_yReverse = value));
	const _zReverse = writable(zReverse);
	component_subscribe($$self, _zReverse, value => $$invalidate(18, $_zReverse = value));
	const _rReverse = writable(rReverse);
	component_subscribe($$self, _rReverse, value => $$invalidate(17, $_rReverse = value));
	const _xPadding = writable(xPadding);
	component_subscribe($$self, _xPadding, value => $$invalidate(16, $_xPadding = value));
	const _yPadding = writable(yPadding);
	component_subscribe($$self, _yPadding, value => $$invalidate(15, $_yPadding = value));
	const _zPadding = writable(zPadding);
	component_subscribe($$self, _zPadding, value => $$invalidate(14, $_zPadding = value));
	const _rPadding = writable(rPadding);
	component_subscribe($$self, _rPadding, value => $$invalidate(13, $_rPadding = value));
	const _xRange = writable(xRange);
	component_subscribe($$self, _xRange, value => $$invalidate(164, $_xRange = value));
	const _yRange = writable(yRange);
	component_subscribe($$self, _yRange, value => $$invalidate(163, $_yRange = value));
	const _zRange = writable(zRange);
	component_subscribe($$self, _zRange, value => $$invalidate(162, $_zRange = value));
	const _rRange = writable(rRange);
	component_subscribe($$self, _rRange, value => $$invalidate(161, $_rRange = value));
	const _xScale = writable(xScale);
	component_subscribe($$self, _xScale, value => $$invalidate(160, $_xScale = value));
	const _yScale = writable(yScale);
	component_subscribe($$self, _yScale, value => $$invalidate(159, $_yScale = value));
	const _zScale = writable(zScale);
	component_subscribe($$self, _zScale, value => $$invalidate(158, $_zScale = value));
	const _rScale = writable(rScale);
	component_subscribe($$self, _rScale, value => $$invalidate(157, $_rScale = value));
	const _config = writable(config);
	component_subscribe($$self, _config, value => $$invalidate(11, $_config = value));
	const _custom = writable(custom);
	component_subscribe($$self, _custom, value => $$invalidate(12, $_custom = value));

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

	component_subscribe($$self, activeGetters_d, value => $$invalidate(10, $activeGetters_d = value));

	const padding_d = derived([_padding, _containerWidth, _containerHeight], ([$padding]) => {
		const defaultPadding = { top: 0, right: 0, bottom: 0, left: 0 };
		return Object.assign(defaultPadding, $padding);
	});

	component_subscribe($$self, padding_d, value => $$invalidate(37, $padding_d = value));

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

	component_subscribe($$self, box_d, value => $$invalidate(151, $box_d = value));

	const width_d = derived([box_d], ([$box]) => {
		return $box.width;
	});

	component_subscribe($$self, width_d, value => $$invalidate(34, $width_d = value));

	const height_d = derived([box_d], ([$box]) => {
		return $box.height;
	});

	component_subscribe($$self, height_d, value => $$invalidate(35, $height_d = value));

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

	component_subscribe($$self, extents_d, value => $$invalidate(38, $extents_d = value));
	const xDomain_d = derived([extents_d, _xDomain], calcDomain('x'));
	component_subscribe($$self, xDomain_d, value => $$invalidate(39, $xDomain_d = value));
	const yDomain_d = derived([extents_d, _yDomain], calcDomain('y'));
	component_subscribe($$self, yDomain_d, value => $$invalidate(40, $yDomain_d = value));
	const zDomain_d = derived([extents_d, _zDomain], calcDomain('z'));
	component_subscribe($$self, zDomain_d, value => $$invalidate(41, $zDomain_d = value));
	const rDomain_d = derived([extents_d, _rDomain], calcDomain('r'));
	component_subscribe($$self, rDomain_d, value => $$invalidate(42, $rDomain_d = value));

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

	component_subscribe($$self, xScale_d, value => $$invalidate(9, $xScale_d = value));
	const xGet_d = derived([_x, xScale_d], createGetter);
	component_subscribe($$self, xGet_d, value => $$invalidate(47, $xGet_d = value));

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

	component_subscribe($$self, yScale_d, value => $$invalidate(8, $yScale_d = value));
	const yGet_d = derived([_y, yScale_d], createGetter);
	component_subscribe($$self, yGet_d, value => $$invalidate(48, $yGet_d = value));

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

	component_subscribe($$self, zScale_d, value => $$invalidate(7, $zScale_d = value));
	const zGet_d = derived([_z, zScale_d], createGetter);
	component_subscribe($$self, zGet_d, value => $$invalidate(49, $zGet_d = value));

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

	component_subscribe($$self, rScale_d, value => $$invalidate(6, $rScale_d = value));
	const rGet_d = derived([_r, rScale_d], createGetter);
	component_subscribe($$self, rGet_d, value => $$invalidate(50, $rGet_d = value));
	const xRange_d = derived([xScale_d], getRange);
	component_subscribe($$self, xRange_d, value => $$invalidate(43, $xRange_d = value));
	const yRange_d = derived([yScale_d], getRange);
	component_subscribe($$self, yRange_d, value => $$invalidate(44, $yRange_d = value));
	const zRange_d = derived([zScale_d], getRange);
	component_subscribe($$self, zRange_d, value => $$invalidate(45, $zRange_d = value));
	const rRange_d = derived([rScale_d], getRange);
	component_subscribe($$self, rRange_d, value => $$invalidate(46, $rRange_d = value));

	const aspectRatio_d = derived([width_d, height_d], ([$width, $height]) => {
		return $width / $height;
	});

	component_subscribe($$self, aspectRatio_d, value => $$invalidate(36, $aspectRatio_d = value));

	function div_binding($$value) {
		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
			element = $$value;
			$$invalidate(2, element);
		});
	}

	function div_elementresize_handler() {
		containerWidth = this.clientWidth;
		containerHeight = this.clientHeight;
		$$invalidate(0, containerWidth);
		$$invalidate(1, containerHeight);
	}

	$$self.$$set = $$props => {
		if ('ssr' in $$props) $$invalidate(3, ssr = $$props.ssr);
		if ('pointerEvents' in $$props) $$invalidate(4, pointerEvents = $$props.pointerEvents);
		if ('position' in $$props) $$invalidate(5, position = $$props.position);
		if ('percentRange' in $$props) $$invalidate(111, percentRange = $$props.percentRange);
		if ('width' in $$props) $$invalidate(112, width = $$props.width);
		if ('height' in $$props) $$invalidate(113, height = $$props.height);
		if ('containerWidth' in $$props) $$invalidate(0, containerWidth = $$props.containerWidth);
		if ('containerHeight' in $$props) $$invalidate(1, containerHeight = $$props.containerHeight);
		if ('element' in $$props) $$invalidate(2, element = $$props.element);
		if ('x' in $$props) $$invalidate(114, x = $$props.x);
		if ('y' in $$props) $$invalidate(115, y = $$props.y);
		if ('z' in $$props) $$invalidate(116, z = $$props.z);
		if ('r' in $$props) $$invalidate(117, r = $$props.r);
		if ('data' in $$props) $$invalidate(118, data = $$props.data);
		if ('xDomain' in $$props) $$invalidate(119, xDomain = $$props.xDomain);
		if ('yDomain' in $$props) $$invalidate(120, yDomain = $$props.yDomain);
		if ('zDomain' in $$props) $$invalidate(121, zDomain = $$props.zDomain);
		if ('rDomain' in $$props) $$invalidate(122, rDomain = $$props.rDomain);
		if ('xNice' in $$props) $$invalidate(123, xNice = $$props.xNice);
		if ('yNice' in $$props) $$invalidate(124, yNice = $$props.yNice);
		if ('zNice' in $$props) $$invalidate(125, zNice = $$props.zNice);
		if ('rNice' in $$props) $$invalidate(126, rNice = $$props.rNice);
		if ('xPadding' in $$props) $$invalidate(127, xPadding = $$props.xPadding);
		if ('yPadding' in $$props) $$invalidate(128, yPadding = $$props.yPadding);
		if ('zPadding' in $$props) $$invalidate(129, zPadding = $$props.zPadding);
		if ('rPadding' in $$props) $$invalidate(130, rPadding = $$props.rPadding);
		if ('xScale' in $$props) $$invalidate(131, xScale = $$props.xScale);
		if ('yScale' in $$props) $$invalidate(132, yScale = $$props.yScale);
		if ('zScale' in $$props) $$invalidate(133, zScale = $$props.zScale);
		if ('rScale' in $$props) $$invalidate(134, rScale = $$props.rScale);
		if ('xRange' in $$props) $$invalidate(135, xRange = $$props.xRange);
		if ('yRange' in $$props) $$invalidate(136, yRange = $$props.yRange);
		if ('zRange' in $$props) $$invalidate(137, zRange = $$props.zRange);
		if ('rRange' in $$props) $$invalidate(138, rRange = $$props.rRange);
		if ('xReverse' in $$props) $$invalidate(139, xReverse = $$props.xReverse);
		if ('yReverse' in $$props) $$invalidate(140, yReverse = $$props.yReverse);
		if ('zReverse' in $$props) $$invalidate(141, zReverse = $$props.zReverse);
		if ('rReverse' in $$props) $$invalidate(142, rReverse = $$props.rReverse);
		if ('padding' in $$props) $$invalidate(143, padding = $$props.padding);
		if ('extents' in $$props) $$invalidate(144, extents = $$props.extents);
		if ('flatData' in $$props) $$invalidate(145, flatData = $$props.flatData);
		if ('custom' in $$props) $$invalidate(146, custom = $$props.custom);
		if ('debug' in $$props) $$invalidate(147, debug = $$props.debug);
		if ('$$scope' in $$props) $$invalidate(152, $$scope = $$props.$$scope);
	};

	$$self.$$.update = () => {
		if ($$self.$$.dirty[4] & /*yReverse, yScale*/ 65792) {
			/**
 * Make this reactive
 */
			$$invalidate(150, yReverseValue = typeof yReverse === 'undefined'
			? typeof yScale.bandwidth === 'function' ? false : true
			: yReverse);
		}

		if ($$self.$$.dirty[3] & /*x*/ 2097152) {
			if (x) $$invalidate(148, config.x = x, config);
		}

		if ($$self.$$.dirty[3] & /*y*/ 4194304) {
			if (y) $$invalidate(148, config.y = y, config);
		}

		if ($$self.$$.dirty[3] & /*z*/ 8388608) {
			if (z) $$invalidate(148, config.z = z, config);
		}

		if ($$self.$$.dirty[3] & /*r*/ 16777216) {
			if (r) $$invalidate(148, config.r = r, config);
		}

		if ($$self.$$.dirty[3] & /*xDomain*/ 67108864) {
			if (xDomain) $$invalidate(148, config.xDomain = xDomain, config);
		}

		if ($$self.$$.dirty[3] & /*yDomain*/ 134217728) {
			if (yDomain) $$invalidate(148, config.yDomain = yDomain, config);
		}

		if ($$self.$$.dirty[3] & /*zDomain*/ 268435456) {
			if (zDomain) $$invalidate(148, config.zDomain = zDomain, config);
		}

		if ($$self.$$.dirty[3] & /*rDomain*/ 536870912) {
			if (rDomain) $$invalidate(148, config.rDomain = rDomain, config);
		}

		if ($$self.$$.dirty[4] & /*xRange*/ 2048) {
			if (xRange) $$invalidate(148, config.xRange = xRange, config);
		}

		if ($$self.$$.dirty[4] & /*yRange*/ 4096) {
			if (yRange) $$invalidate(148, config.yRange = yRange, config);
		}

		if ($$self.$$.dirty[4] & /*zRange*/ 8192) {
			if (zRange) $$invalidate(148, config.zRange = zRange, config);
		}

		if ($$self.$$.dirty[4] & /*rRange*/ 16384) {
			if (rRange) $$invalidate(148, config.rRange = rRange, config);
		}

		if ($$self.$$.dirty[3] & /*percentRange*/ 262144) {
			set_store_value(_percentRange, $_percentRange = percentRange, $_percentRange);
		}

		if ($$self.$$.dirty[0] & /*containerWidth*/ 1) {
			set_store_value(_containerWidth, $_containerWidth = containerWidth, $_containerWidth);
		}

		if ($$self.$$.dirty[0] & /*containerHeight*/ 2) {
			set_store_value(_containerHeight, $_containerHeight = containerHeight, $_containerHeight);
		}

		if ($$self.$$.dirty[4] & /*extents*/ 1048576) {
			set_store_value(_extents, $_extents = filterObject(extents), $_extents);
		}

		if ($$self.$$.dirty[3] & /*data*/ 33554432) {
			set_store_value(_data, $_data = data, $_data);
		}

		if ($$self.$$.dirty[3] & /*data*/ 33554432 | $$self.$$.dirty[4] & /*flatData*/ 2097152) {
			set_store_value(_flatData, $_flatData = flatData || data, $_flatData);
		}

		if ($$self.$$.dirty[4] & /*padding*/ 524288) {
			set_store_value(_padding, $_padding = padding, $_padding);
		}

		if ($$self.$$.dirty[3] & /*x*/ 2097152) {
			set_store_value(_x, $_x = makeAccessor(x), $_x);
		}

		if ($$self.$$.dirty[3] & /*y*/ 4194304) {
			set_store_value(_y, $_y = makeAccessor(y), $_y);
		}

		if ($$self.$$.dirty[3] & /*z*/ 8388608) {
			set_store_value(_z, $_z = makeAccessor(z), $_z);
		}

		if ($$self.$$.dirty[3] & /*r*/ 16777216) {
			set_store_value(_r, $_r = makeAccessor(r), $_r);
		}

		if ($$self.$$.dirty[3] & /*xDomain*/ 67108864) {
			set_store_value(_xDomain, $_xDomain = xDomain, $_xDomain);
		}

		if ($$self.$$.dirty[3] & /*yDomain*/ 134217728) {
			set_store_value(_yDomain, $_yDomain = yDomain, $_yDomain);
		}

		if ($$self.$$.dirty[3] & /*zDomain*/ 268435456) {
			set_store_value(_zDomain, $_zDomain = zDomain, $_zDomain);
		}

		if ($$self.$$.dirty[3] & /*rDomain*/ 536870912) {
			set_store_value(_rDomain, $_rDomain = rDomain, $_rDomain);
		}

		if ($$self.$$.dirty[3] & /*xNice*/ 1073741824) {
			set_store_value(_xNice, $_xNice = xNice, $_xNice);
		}

		if ($$self.$$.dirty[4] & /*yNice*/ 1) {
			set_store_value(_yNice, $_yNice = yNice, $_yNice);
		}

		if ($$self.$$.dirty[4] & /*zNice*/ 2) {
			set_store_value(_zNice, $_zNice = zNice, $_zNice);
		}

		if ($$self.$$.dirty[4] & /*rNice*/ 4) {
			set_store_value(_rNice, $_rNice = rNice, $_rNice);
		}

		if ($$self.$$.dirty[4] & /*xReverse*/ 32768) {
			set_store_value(_xReverse, $_xReverse = xReverse, $_xReverse);
		}

		if ($$self.$$.dirty[4] & /*yReverseValue*/ 67108864) {
			set_store_value(_yReverse, $_yReverse = yReverseValue, $_yReverse);
		}

		if ($$self.$$.dirty[4] & /*zReverse*/ 131072) {
			set_store_value(_zReverse, $_zReverse = zReverse, $_zReverse);
		}

		if ($$self.$$.dirty[4] & /*rReverse*/ 262144) {
			set_store_value(_rReverse, $_rReverse = rReverse, $_rReverse);
		}

		if ($$self.$$.dirty[4] & /*xPadding*/ 8) {
			set_store_value(_xPadding, $_xPadding = xPadding, $_xPadding);
		}

		if ($$self.$$.dirty[4] & /*yPadding*/ 16) {
			set_store_value(_yPadding, $_yPadding = yPadding, $_yPadding);
		}

		if ($$self.$$.dirty[4] & /*zPadding*/ 32) {
			set_store_value(_zPadding, $_zPadding = zPadding, $_zPadding);
		}

		if ($$self.$$.dirty[4] & /*rPadding*/ 64) {
			set_store_value(_rPadding, $_rPadding = rPadding, $_rPadding);
		}

		if ($$self.$$.dirty[4] & /*xRange*/ 2048) {
			set_store_value(_xRange, $_xRange = xRange, $_xRange);
		}

		if ($$self.$$.dirty[4] & /*yRange*/ 4096) {
			set_store_value(_yRange, $_yRange = yRange, $_yRange);
		}

		if ($$self.$$.dirty[4] & /*zRange*/ 8192) {
			set_store_value(_zRange, $_zRange = zRange, $_zRange);
		}

		if ($$self.$$.dirty[4] & /*rRange*/ 16384) {
			set_store_value(_rRange, $_rRange = rRange, $_rRange);
		}

		if ($$self.$$.dirty[4] & /*xScale*/ 128) {
			set_store_value(_xScale, $_xScale = xScale, $_xScale);
		}

		if ($$self.$$.dirty[4] & /*yScale*/ 256) {
			set_store_value(_yScale, $_yScale = yScale, $_yScale);
		}

		if ($$self.$$.dirty[4] & /*zScale*/ 512) {
			set_store_value(_zScale, $_zScale = zScale, $_zScale);
		}

		if ($$self.$$.dirty[4] & /*rScale*/ 1024) {
			set_store_value(_rScale, $_rScale = rScale, $_rScale);
		}

		if ($$self.$$.dirty[4] & /*custom*/ 4194304) {
			set_store_value(_custom, $_custom = custom, $_custom);
		}

		if ($$self.$$.dirty[4] & /*config*/ 16777216) {
			set_store_value(_config, $_config = config, $_config);
		}

		if ($$self.$$.dirty[4] & /*context*/ 33554432) {
			setContext('LayerCake', context);
		}

		if ($$self.$$.dirty[0] & /*ssr, $activeGetters_d, $xScale_d, $yScale_d, $zScale_d, $rScale_d*/ 1992 | $$self.$$.dirty[4] & /*$box_d, debug, config*/ 159383552) {
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
	};

	$$invalidate(149, context = {
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
	});

	return [
		containerWidth,
		containerHeight,
		element,
		ssr,
		pointerEvents,
		position,
		$rScale_d,
		$zScale_d,
		$yScale_d,
		$xScale_d,
		$activeGetters_d,
		$_config,
		$_custom,
		$_rPadding,
		$_zPadding,
		$_yPadding,
		$_xPadding,
		$_rReverse,
		$_zReverse,
		$_yReverse,
		$_xReverse,
		$_rNice,
		$_zNice,
		$_yNice,
		$_xNice,
		$_r,
		$_z,
		$_y,
		$_x,
		$_flatData,
		$_data,
		$_containerHeight,
		$_containerWidth,
		$_percentRange,
		$width_d,
		$height_d,
		$aspectRatio_d,
		$padding_d,
		$extents_d,
		$xDomain_d,
		$yDomain_d,
		$zDomain_d,
		$rDomain_d,
		$xRange_d,
		$yRange_d,
		$zRange_d,
		$rRange_d,
		$xGet_d,
		$yGet_d,
		$zGet_d,
		$rGet_d,
		_percentRange,
		_containerWidth,
		_containerHeight,
		_extents,
		_data,
		_flatData,
		_padding,
		_x,
		_y,
		_z,
		_r,
		_xDomain,
		_yDomain,
		_zDomain,
		_rDomain,
		_xNice,
		_yNice,
		_zNice,
		_rNice,
		_xReverse,
		_yReverse,
		_zReverse,
		_rReverse,
		_xPadding,
		_yPadding,
		_zPadding,
		_rPadding,
		_xRange,
		_yRange,
		_zRange,
		_rRange,
		_xScale,
		_yScale,
		_zScale,
		_rScale,
		_config,
		_custom,
		activeGetters_d,
		padding_d,
		box_d,
		width_d,
		height_d,
		extents_d,
		xDomain_d,
		yDomain_d,
		zDomain_d,
		rDomain_d,
		xScale_d,
		xGet_d,
		yScale_d,
		yGet_d,
		zScale_d,
		zGet_d,
		rScale_d,
		rGet_d,
		xRange_d,
		yRange_d,
		zRange_d,
		rRange_d,
		aspectRatio_d,
		percentRange,
		width,
		height,
		x,
		y,
		z,
		r,
		data,
		xDomain,
		yDomain,
		zDomain,
		rDomain,
		xNice,
		yNice,
		zNice,
		rNice,
		xPadding,
		yPadding,
		zPadding,
		rPadding,
		xScale,
		yScale,
		zScale,
		rScale,
		xRange,
		yRange,
		zRange,
		rRange,
		xReverse,
		yReverse,
		zReverse,
		rReverse,
		padding,
		extents,
		flatData,
		custom,
		debug,
		config,
		context,
		yReverseValue,
		$box_d,
		$$scope,
		slots,
		div_binding,
		div_elementresize_handler
	];
}

class LayerCake extends SvelteComponent {
	constructor(options) {
		super();

		init(
			this,
			options,
			instance$8,
			create_fragment$7,
			safe_not_equal,
			{
				ssr: 3,
				pointerEvents: 4,
				position: 5,
				percentRange: 111,
				width: 112,
				height: 113,
				containerWidth: 0,
				containerHeight: 1,
				element: 2,
				x: 114,
				y: 115,
				z: 116,
				r: 117,
				data: 118,
				xDomain: 119,
				yDomain: 120,
				zDomain: 121,
				rDomain: 122,
				xNice: 123,
				yNice: 124,
				zNice: 125,
				rNice: 126,
				xPadding: 127,
				yPadding: 128,
				zPadding: 129,
				rPadding: 130,
				xScale: 131,
				yScale: 132,
				zScale: 133,
				rScale: 134,
				xRange: 135,
				yRange: 136,
				zRange: 137,
				rRange: 138,
				xReverse: 139,
				yReverse: 140,
				zReverse: 141,
				rReverse: 142,
				padding: 143,
				extents: 144,
				flatData: 145,
				custom: 146,
				debug: 147
			},
			add_css$4,
			[-1, -1, -1, -1, -1, -1]
		);
	}
}

/* node_modules/layercake/dist/layouts/Svg.svelte generated by Svelte v4.2.9 */

function add_css$3(target) {
	append_styles(target, "svelte-u84d8d", "svg.svelte-u84d8d{position:absolute;top:0;left:0;overflow:visible}");
}

const get_default_slot_changes$2 = dirty => ({ element: dirty & /*element*/ 1 });
const get_default_slot_context$2 = ctx => ({ element: /*element*/ ctx[0] });
const get_defs_slot_changes = dirty => ({});
const get_defs_slot_context = ctx => ({});
const get_title_slot_changes = dirty => ({});
const get_title_slot_context = ctx => ({});

// (50:20) {#if title}
function create_if_block$4(ctx) {
	let title_1;
	let t;

	return {
		c() {
			title_1 = svg_element("title");
			t = text(/*title*/ ctx[8]);
		},
		l(nodes) {
			title_1 = claim_svg_element(nodes, "title", {});
			var title_1_nodes = children(title_1);
			t = claim_text(title_1_nodes, /*title*/ ctx[8]);
			title_1_nodes.forEach(detach);
		},
		m(target, anchor) {
			insert_hydration(target, title_1, anchor);
			append_hydration(title_1, t);
		},
		p(ctx, dirty) {
			if (dirty & /*title*/ 256) set_data(t, /*title*/ ctx[8]);
		},
		d(detaching) {
			if (detaching) {
				detach(title_1);
			}
		}
	};
}

// (50:20) {#if title}
function fallback_block$1(ctx) {
	let if_block_anchor;
	let if_block = /*title*/ ctx[8] && create_if_block$4(ctx);

	return {
		c() {
			if (if_block) if_block.c();
			if_block_anchor = empty();
		},
		l(nodes) {
			if (if_block) if_block.l(nodes);
			if_block_anchor = empty();
		},
		m(target, anchor) {
			if (if_block) if_block.m(target, anchor);
			insert_hydration(target, if_block_anchor, anchor);
		},
		p(ctx, dirty) {
			if (/*title*/ ctx[8]) {
				if (if_block) {
					if_block.p(ctx, dirty);
				} else {
					if_block = create_if_block$4(ctx);
					if_block.c();
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			} else if (if_block) {
				if_block.d(1);
				if_block = null;
			}
		},
		d(detaching) {
			if (detaching) {
				detach(if_block_anchor);
			}

			if (if_block) if_block.d(detaching);
		}
	};
}

function create_fragment$6(ctx) {
	let svg;
	let defs;
	let g;
	let g_transform_value;
	let current;
	const title_slot_template = /*#slots*/ ctx[16].title;
	const title_slot = create_slot(title_slot_template, ctx, /*$$scope*/ ctx[15], get_title_slot_context);
	const title_slot_or_fallback = title_slot || fallback_block$1(ctx);
	const defs_slot_template = /*#slots*/ ctx[16].defs;
	const defs_slot = create_slot(defs_slot_template, ctx, /*$$scope*/ ctx[15], get_defs_slot_context);
	const default_slot_template = /*#slots*/ ctx[16].default;
	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[15], get_default_slot_context$2);

	return {
		c() {
			svg = svg_element("svg");
			if (title_slot_or_fallback) title_slot_or_fallback.c();
			defs = svg_element("defs");
			if (defs_slot) defs_slot.c();
			g = svg_element("g");
			if (default_slot) default_slot.c();
			this.h();
		},
		l(nodes) {
			svg = claim_svg_element(nodes, "svg", {
				class: true,
				viewBox: true,
				width: true,
				height: true,
				"aria-label": true,
				"aria-labelledby": true,
				"aria-describedby": true
			});

			var svg_nodes = children(svg);
			if (title_slot_or_fallback) title_slot_or_fallback.l(svg_nodes);
			defs = claim_svg_element(svg_nodes, "defs", {});
			var defs_nodes = children(defs);
			if (defs_slot) defs_slot.l(defs_nodes);
			defs_nodes.forEach(detach);
			g = claim_svg_element(svg_nodes, "g", { class: true, transform: true });
			var g_nodes = children(g);
			if (default_slot) default_slot.l(g_nodes);
			g_nodes.forEach(detach);
			svg_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(g, "class", "layercake-layout-svg_g");
			attr(g, "transform", g_transform_value = "translate(" + /*$padding*/ ctx[11].left + ", " + /*$padding*/ ctx[11].top + ")");
			attr(svg, "class", "layercake-layout-svg svelte-u84d8d");
			attr(svg, "viewBox", /*viewBox*/ ctx[4]);
			attr(svg, "width", /*$containerWidth*/ ctx[9]);
			attr(svg, "height", /*$containerHeight*/ ctx[10]);
			attr(svg, "aria-label", /*label*/ ctx[5]);
			attr(svg, "aria-labelledby", /*labelledBy*/ ctx[6]);
			attr(svg, "aria-describedby", /*describedBy*/ ctx[7]);
			set_style(svg, "z-index", /*zIndex*/ ctx[2]);
			set_style(svg, "pointer-events", /*pointerEvents*/ ctx[3] === false ? 'none' : null);
		},
		m(target, anchor) {
			insert_hydration(target, svg, anchor);

			if (title_slot_or_fallback) {
				title_slot_or_fallback.m(svg, null);
			}

			append_hydration(svg, defs);

			if (defs_slot) {
				defs_slot.m(defs, null);
			}

			append_hydration(svg, g);

			if (default_slot) {
				default_slot.m(g, null);
			}

			/*g_binding*/ ctx[17](g);
			/*svg_binding*/ ctx[18](svg);
			current = true;
		},
		p(ctx, [dirty]) {
			if (title_slot) {
				if (title_slot.p && (!current || dirty & /*$$scope*/ 32768)) {
					update_slot_base(
						title_slot,
						title_slot_template,
						ctx,
						/*$$scope*/ ctx[15],
						!current
						? get_all_dirty_from_scope(/*$$scope*/ ctx[15])
						: get_slot_changes(title_slot_template, /*$$scope*/ ctx[15], dirty, get_title_slot_changes),
						get_title_slot_context
					);
				}
			} else {
				if (title_slot_or_fallback && title_slot_or_fallback.p && (!current || dirty & /*title*/ 256)) {
					title_slot_or_fallback.p(ctx, !current ? -1 : dirty);
				}
			}

			if (defs_slot) {
				if (defs_slot.p && (!current || dirty & /*$$scope*/ 32768)) {
					update_slot_base(
						defs_slot,
						defs_slot_template,
						ctx,
						/*$$scope*/ ctx[15],
						!current
						? get_all_dirty_from_scope(/*$$scope*/ ctx[15])
						: get_slot_changes(defs_slot_template, /*$$scope*/ ctx[15], dirty, get_defs_slot_changes),
						get_defs_slot_context
					);
				}
			}

			if (default_slot) {
				if (default_slot.p && (!current || dirty & /*$$scope, element*/ 32769)) {
					update_slot_base(
						default_slot,
						default_slot_template,
						ctx,
						/*$$scope*/ ctx[15],
						!current
						? get_all_dirty_from_scope(/*$$scope*/ ctx[15])
						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[15], dirty, get_default_slot_changes$2),
						get_default_slot_context$2
					);
				}
			}

			if (!current || dirty & /*$padding*/ 2048 && g_transform_value !== (g_transform_value = "translate(" + /*$padding*/ ctx[11].left + ", " + /*$padding*/ ctx[11].top + ")")) {
				attr(g, "transform", g_transform_value);
			}

			if (!current || dirty & /*viewBox*/ 16) {
				attr(svg, "viewBox", /*viewBox*/ ctx[4]);
			}

			if (!current || dirty & /*$containerWidth*/ 512) {
				attr(svg, "width", /*$containerWidth*/ ctx[9]);
			}

			if (!current || dirty & /*$containerHeight*/ 1024) {
				attr(svg, "height", /*$containerHeight*/ ctx[10]);
			}

			if (!current || dirty & /*label*/ 32) {
				attr(svg, "aria-label", /*label*/ ctx[5]);
			}

			if (!current || dirty & /*labelledBy*/ 64) {
				attr(svg, "aria-labelledby", /*labelledBy*/ ctx[6]);
			}

			if (!current || dirty & /*describedBy*/ 128) {
				attr(svg, "aria-describedby", /*describedBy*/ ctx[7]);
			}

			if (dirty & /*zIndex*/ 4) {
				set_style(svg, "z-index", /*zIndex*/ ctx[2]);
			}

			if (dirty & /*pointerEvents*/ 8) {
				set_style(svg, "pointer-events", /*pointerEvents*/ ctx[3] === false ? 'none' : null);
			}
		},
		i(local) {
			if (current) return;
			transition_in(title_slot_or_fallback, local);
			transition_in(defs_slot, local);
			transition_in(default_slot, local);
			current = true;
		},
		o(local) {
			transition_out(title_slot_or_fallback, local);
			transition_out(defs_slot, local);
			transition_out(default_slot, local);
			current = false;
		},
		d(detaching) {
			if (detaching) {
				detach(svg);
			}

			if (title_slot_or_fallback) title_slot_or_fallback.d(detaching);
			if (defs_slot) defs_slot.d(detaching);
			if (default_slot) default_slot.d(detaching);
			/*g_binding*/ ctx[17](null);
			/*svg_binding*/ ctx[18](null);
		}
	};
}

function instance$7($$self, $$props, $$invalidate) {
	let $containerWidth;
	let $containerHeight;
	let $padding;
	let { $$slots: slots = {}, $$scope } = $$props;
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
	component_subscribe($$self, containerWidth, value => $$invalidate(9, $containerWidth = value));
	component_subscribe($$self, containerHeight, value => $$invalidate(10, $containerHeight = value));
	component_subscribe($$self, padding, value => $$invalidate(11, $padding = value));

	function g_binding($$value) {
		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
			innerElement = $$value;
			$$invalidate(1, innerElement);
		});
	}

	function svg_binding($$value) {
		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
			element = $$value;
			$$invalidate(0, element);
		});
	}

	$$self.$$set = $$props => {
		if ('element' in $$props) $$invalidate(0, element = $$props.element);
		if ('innerElement' in $$props) $$invalidate(1, innerElement = $$props.innerElement);
		if ('zIndex' in $$props) $$invalidate(2, zIndex = $$props.zIndex);
		if ('pointerEvents' in $$props) $$invalidate(3, pointerEvents = $$props.pointerEvents);
		if ('viewBox' in $$props) $$invalidate(4, viewBox = $$props.viewBox);
		if ('label' in $$props) $$invalidate(5, label = $$props.label);
		if ('labelledBy' in $$props) $$invalidate(6, labelledBy = $$props.labelledBy);
		if ('describedBy' in $$props) $$invalidate(7, describedBy = $$props.describedBy);
		if ('title' in $$props) $$invalidate(8, title = $$props.title);
		if ('$$scope' in $$props) $$invalidate(15, $$scope = $$props.$$scope);
	};

	return [
		element,
		innerElement,
		zIndex,
		pointerEvents,
		viewBox,
		label,
		labelledBy,
		describedBy,
		title,
		$containerWidth,
		$containerHeight,
		$padding,
		containerWidth,
		containerHeight,
		padding,
		$$scope,
		slots,
		g_binding,
		svg_binding
	];
}

class Svg extends SvelteComponent {
	constructor(options) {
		super();

		init(
			this,
			options,
			instance$7,
			create_fragment$6,
			safe_not_equal,
			{
				element: 0,
				innerElement: 1,
				zIndex: 2,
				pointerEvents: 3,
				viewBox: 4,
				label: 5,
				labelledBy: 6,
				describedBy: 7,
				title: 8
			},
			add_css$3
		);
	}
}

/**
	Scales a canvas. From Paul Lewis: http://www.html5rocks.com/en/tutorials/canvas/hidpi/
	@param {CanvasRenderingContext2D} ctx A canvas context.
	@param {Number} width The container width.
	@param {Number} height The container height.
	@returns {{width: Number, height: Number}}
*/
function scaleCanvas (ctx, width, height) {
	const dpr = window.devicePixelRatio || 1;

	ctx.canvas.width = width * dpr;
	ctx.canvas.height = height * dpr;

	ctx.canvas.style.width = `${width}px`;
	ctx.canvas.style.height = `${height}px`;

	ctx.scale(dpr, dpr);
	return { width: ctx.canvas.width, height: ctx.canvas.height };
}

/* node_modules/layercake/dist/layouts/Canvas.svelte generated by Svelte v4.2.9 */

const get_default_slot_changes$1 = dirty => ({
	element: dirty & /*element*/ 2,
	context: dirty & /*context*/ 1
});

const get_default_slot_context$1 = ctx => ({
	element: /*element*/ ctx[1],
	context: /*context*/ ctx[0]
});

const get_fallback_slot_changes = dirty => ({});
const get_fallback_slot_context = ctx => ({});

// (62:23) {#if fallback}
function create_if_block$3(ctx) {
	let t;

	return {
		c() {
			t = text(/*fallback*/ ctx[4]);
		},
		l(nodes) {
			t = claim_text(nodes, /*fallback*/ ctx[4]);
		},
		m(target, anchor) {
			insert_hydration(target, t, anchor);
		},
		p(ctx, dirty) {
			if (dirty & /*fallback*/ 16) set_data(t, /*fallback*/ ctx[4]);
		},
		d(detaching) {
			if (detaching) {
				detach(t);
			}
		}
	};
}

// (62:23) {#if fallback}
function fallback_block(ctx) {
	let if_block_anchor;
	let if_block = /*fallback*/ ctx[4] && create_if_block$3(ctx);

	return {
		c() {
			if (if_block) if_block.c();
			if_block_anchor = empty();
		},
		l(nodes) {
			if (if_block) if_block.l(nodes);
			if_block_anchor = empty();
		},
		m(target, anchor) {
			if (if_block) if_block.m(target, anchor);
			insert_hydration(target, if_block_anchor, anchor);
		},
		p(ctx, dirty) {
			if (/*fallback*/ ctx[4]) {
				if (if_block) {
					if_block.p(ctx, dirty);
				} else {
					if_block = create_if_block$3(ctx);
					if_block.c();
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			} else if (if_block) {
				if_block.d(1);
				if_block = null;
			}
		},
		d(detaching) {
			if (detaching) {
				detach(if_block_anchor);
			}

			if (if_block) if_block.d(detaching);
		}
	};
}

function create_fragment$5(ctx) {
	let canvas;
	let t;
	let current;
	const fallback_slot_template = /*#slots*/ ctx[13].fallback;
	const fallback_slot = create_slot(fallback_slot_template, ctx, /*$$scope*/ ctx[12], get_fallback_slot_context);
	const fallback_slot_or_fallback = fallback_slot || fallback_block(ctx);
	const default_slot_template = /*#slots*/ ctx[13].default;
	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[12], get_default_slot_context$1);

	return {
		c() {
			canvas = element("canvas");
			if (fallback_slot_or_fallback) fallback_slot_or_fallback.c();
			t = space();
			if (default_slot) default_slot.c();
			this.h();
		},
		l(nodes) {
			canvas = claim_element(nodes, "CANVAS", {
				class: true,
				style: true,
				"aria-label": true,
				"aria-labelledby": true,
				"aria-describedby": true
			});

			var canvas_nodes = children(canvas);
			if (fallback_slot_or_fallback) fallback_slot_or_fallback.l(canvas_nodes);
			canvas_nodes.forEach(detach);
			t = claim_space(nodes);
			if (default_slot) default_slot.l(nodes);
			this.h();
		},
		h() {
			attr(canvas, "class", "layercake-layout-canvas");
			set_style(canvas, "width", "100%");
			set_style(canvas, "height", "100%");
			set_style(canvas, "position", "absolute");
			attr(canvas, "aria-label", /*label*/ ctx[5]);
			attr(canvas, "aria-labelledby", /*labelledBy*/ ctx[6]);
			attr(canvas, "aria-describedby", /*describedBy*/ ctx[7]);
			set_style(canvas, "z-index", /*zIndex*/ ctx[2]);
			set_style(canvas, "pointer-events", /*pointerEvents*/ ctx[3] === false ? 'none' : null);
			set_style(canvas, "top", /*$padding*/ ctx[8].top + 'px');
			set_style(canvas, "right", /*$padding*/ ctx[8].right + 'px');
			set_style(canvas, "bottom", /*$padding*/ ctx[8].bottom + 'px');
			set_style(canvas, "left", /*$padding*/ ctx[8].left + 'px');
		},
		m(target, anchor) {
			insert_hydration(target, canvas, anchor);

			if (fallback_slot_or_fallback) {
				fallback_slot_or_fallback.m(canvas, null);
			}

			/*canvas_binding*/ ctx[14](canvas);
			insert_hydration(target, t, anchor);

			if (default_slot) {
				default_slot.m(target, anchor);
			}

			current = true;
		},
		p(ctx, [dirty]) {
			if (fallback_slot) {
				if (fallback_slot.p && (!current || dirty & /*$$scope*/ 4096)) {
					update_slot_base(
						fallback_slot,
						fallback_slot_template,
						ctx,
						/*$$scope*/ ctx[12],
						!current
						? get_all_dirty_from_scope(/*$$scope*/ ctx[12])
						: get_slot_changes(fallback_slot_template, /*$$scope*/ ctx[12], dirty, get_fallback_slot_changes),
						get_fallback_slot_context
					);
				}
			} else {
				if (fallback_slot_or_fallback && fallback_slot_or_fallback.p && (!current || dirty & /*fallback*/ 16)) {
					fallback_slot_or_fallback.p(ctx, !current ? -1 : dirty);
				}
			}

			if (!current || dirty & /*label*/ 32) {
				attr(canvas, "aria-label", /*label*/ ctx[5]);
			}

			if (!current || dirty & /*labelledBy*/ 64) {
				attr(canvas, "aria-labelledby", /*labelledBy*/ ctx[6]);
			}

			if (!current || dirty & /*describedBy*/ 128) {
				attr(canvas, "aria-describedby", /*describedBy*/ ctx[7]);
			}

			if (dirty & /*zIndex*/ 4) {
				set_style(canvas, "z-index", /*zIndex*/ ctx[2]);
			}

			if (dirty & /*pointerEvents*/ 8) {
				set_style(canvas, "pointer-events", /*pointerEvents*/ ctx[3] === false ? 'none' : null);
			}

			if (dirty & /*$padding*/ 256) {
				set_style(canvas, "top", /*$padding*/ ctx[8].top + 'px');
			}

			if (dirty & /*$padding*/ 256) {
				set_style(canvas, "right", /*$padding*/ ctx[8].right + 'px');
			}

			if (dirty & /*$padding*/ 256) {
				set_style(canvas, "bottom", /*$padding*/ ctx[8].bottom + 'px');
			}

			if (dirty & /*$padding*/ 256) {
				set_style(canvas, "left", /*$padding*/ ctx[8].left + 'px');
			}

			if (default_slot) {
				if (default_slot.p && (!current || dirty & /*$$scope, element, context*/ 4099)) {
					update_slot_base(
						default_slot,
						default_slot_template,
						ctx,
						/*$$scope*/ ctx[12],
						!current
						? get_all_dirty_from_scope(/*$$scope*/ ctx[12])
						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[12], dirty, get_default_slot_changes$1),
						get_default_slot_context$1
					);
				}
			}
		},
		i(local) {
			if (current) return;
			transition_in(fallback_slot_or_fallback, local);
			transition_in(default_slot, local);
			current = true;
		},
		o(local) {
			transition_out(fallback_slot_or_fallback, local);
			transition_out(default_slot, local);
			current = false;
		},
		d(detaching) {
			if (detaching) {
				detach(canvas);
				detach(t);
			}

			if (fallback_slot_or_fallback) fallback_slot_or_fallback.d(detaching);
			/*canvas_binding*/ ctx[14](null);
			if (default_slot) default_slot.d(detaching);
		}
	};
}

function instance$6($$self, $$props, $$invalidate) {
	let $height;
	let $width;
	let $padding;
	let { $$slots: slots = {}, $$scope } = $$props;
	const { width, height, padding } = getContext('LayerCake');
	component_subscribe($$self, width, value => $$invalidate(16, $width = value));
	component_subscribe($$self, height, value => $$invalidate(15, $height = value));
	component_subscribe($$self, padding, value => $$invalidate(8, $padding = value));
	let { element = undefined } = $$props;
	let { context = undefined } = $$props;
	let { zIndex = undefined } = $$props;
	let { pointerEvents = undefined } = $$props;
	let { fallback = '' } = $$props;
	let { label = undefined } = $$props;
	let { labelledBy = undefined } = $$props;
	let { describedBy = undefined } = $$props;
	const cntxt = { ctx: writable({}) };

	onMount(() => {
		$$invalidate(0, context = element.getContext('2d'));
		scaleCanvas(context, $width, $height);
	});

	setContext('canvas', cntxt);

	function canvas_binding($$value) {
		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
			element = $$value;
			$$invalidate(1, element);
		});
	}

	$$self.$$set = $$props => {
		if ('element' in $$props) $$invalidate(1, element = $$props.element);
		if ('context' in $$props) $$invalidate(0, context = $$props.context);
		if ('zIndex' in $$props) $$invalidate(2, zIndex = $$props.zIndex);
		if ('pointerEvents' in $$props) $$invalidate(3, pointerEvents = $$props.pointerEvents);
		if ('fallback' in $$props) $$invalidate(4, fallback = $$props.fallback);
		if ('label' in $$props) $$invalidate(5, label = $$props.label);
		if ('labelledBy' in $$props) $$invalidate(6, labelledBy = $$props.labelledBy);
		if ('describedBy' in $$props) $$invalidate(7, describedBy = $$props.describedBy);
		if ('$$scope' in $$props) $$invalidate(12, $$scope = $$props.$$scope);
	};

	$$self.$$.update = () => {
		if ($$self.$$.dirty & /*context*/ 1) {
			cntxt.ctx.set(context);
		}
	};

	return [
		context,
		element,
		zIndex,
		pointerEvents,
		fallback,
		label,
		labelledBy,
		describedBy,
		$padding,
		width,
		height,
		padding,
		$$scope,
		slots,
		canvas_binding
	];
}

class Canvas extends SvelteComponent {
	constructor(options) {
		super();

		init(this, options, instance$6, create_fragment$5, safe_not_equal, {
			element: 1,
			context: 0,
			zIndex: 2,
			pointerEvents: 3,
			fallback: 4,
			label: 5,
			labelledBy: 6,
			describedBy: 7
		});
	}
}

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
const get_default_slot_changes = dirty => ({ d: dirty & /*stack*/ 1 });
const get_default_slot_context = ctx => ({ d: /*stack*/ ctx[0] });

function create_fragment$4(ctx) {
	let current;
	const default_slot_template = /*#slots*/ ctx[7].default;
	const default_slot = create_slot(default_slot_template, ctx, /*$$scope*/ ctx[6], get_default_slot_context);

	return {
		c() {
			if (default_slot) default_slot.c();
		},
		l(nodes) {
			if (default_slot) default_slot.l(nodes);
		},
		m(target, anchor) {
			if (default_slot) {
				default_slot.m(target, anchor);
			}

			current = true;
		},
		p(ctx, [dirty]) {
			if (default_slot) {
				if (default_slot.p && (!current || dirty & /*$$scope, stack*/ 65)) {
					update_slot_base(
						default_slot,
						default_slot_template,
						ctx,
						/*$$scope*/ ctx[6],
						!current
						? get_all_dirty_from_scope(/*$$scope*/ ctx[6])
						: get_slot_changes(default_slot_template, /*$$scope*/ ctx[6], dirty, get_default_slot_changes),
						get_default_slot_context
					);
				}
			}
		},
		i(local) {
			if (current) return;
			transition_in(default_slot, local);
			current = true;
		},
		o(local) {
			transition_out(default_slot, local);
			current = false;
		},
		d(detaching) {
			if (default_slot) default_slot.d(detaching);
		}
	};
}

function instance$5($$self, $$props, $$invalidate) {
	let $yScale;
	let { $$slots: slots = {}, $$scope } = $$props;
	const { xRange, yRange, yScale, width } = getContext('LayerCake');
	component_subscribe($$self, yScale, value => $$invalidate(5, $yScale = value));
	let { offSet = 0 } = $$props;
	let { i = 0 } = $$props;
	let { y = 0 } = $$props;
	let { stack = [] } = $$props;

	$$self.$$set = $$props => {
		if ('offSet' in $$props) $$invalidate(2, offSet = $$props.offSet);
		if ('i' in $$props) $$invalidate(3, i = $$props.i);
		if ('y' in $$props) $$invalidate(4, y = $$props.y);
		if ('stack' in $$props) $$invalidate(0, stack = $$props.stack);
		if ('$$scope' in $$props) $$invalidate(6, $$scope = $$props.$$scope);
	};

	$$self.$$.update = () => {
		if ($$self.$$.dirty & /*stack, $yScale, offSet*/ 37) {
			{
				$$invalidate(0, stack = stack.map(d => ({ d, coord: $yScale(d) })));

				for (let i in stack) {
					//die einträge gehen von oben nach unten
					// d.h. die y-werte werden kleiner
					// also sollte der jetzige wert kleiner sein als der vorausgehende
					if (stack[i].coord + offSet > stack[i - 1]?.coord) $$invalidate(0, stack[i].coord = stack[i - 1]?.coord - offSet, stack);
				}
			}
		}
	};

	return [stack, yScale, offSet, i, y, $yScale, $$scope, slots];
}

class Dodger extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$5, create_fragment$4, safe_not_equal, { offSet: 2, i: 3, y: 4, stack: 0 });
	}
}

/* src/routes/seqplot/stream/AxisY.svelte generated by Svelte v4.2.9 */

function add_css$2(target) {
	append_styles(target, "svelte-zyly5l", ".tick.svelte-zyly5l.svelte-zyly5l{font-size:11px}.tick.svelte-zyly5l line.svelte-zyly5l{stroke:#aaa}.tick.svelte-zyly5l .gridline.svelte-zyly5l{stroke-dasharray:2}.tick.svelte-zyly5l text.svelte-zyly5l{fill:#666}.tick.tick-0.svelte-zyly5l line.svelte-zyly5l{stroke-dasharray:0}");
}

function get_each_context$2(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[32] = list[i];
	child_ctx[35] = i;
	const constants_0 = /*$yScale*/ child_ctx[13](/*tick*/ child_ctx[32].d);
	child_ctx[33] = constants_0;
	return child_ctx;
}

// (85:2) {#if axisLine}
function create_if_block_3(ctx) {
	let line;
	let line_y__value;
	let line_y__value_1;

	return {
		c() {
			line = svg_element("line");
			this.h();
		},
		l(nodes) {
			line = claim_svg_element(nodes, "line", {
				x1: true,
				x2: true,
				y1: true,
				y2: true,
				style: true
			});

			children(line).forEach(detach);
			this.h();
		},
		h() {
			attr(line, "x1", /*x1*/ ctx[16]);
			attr(line, "x2", /*x1*/ ctx[16]);
			attr(line, "y1", line_y__value = /*tickVals*/ ctx[11].map(/*$yScale*/ ctx[13])[0]);
			attr(line, "y2", line_y__value_1 = /*tickVals*/ ctx[11].map(/*$yScale*/ ctx[13])[/*tickVals*/ ctx[11].length - 1]);
			set_style(line, "stroke-width", "1");
			set_style(line, "stroke", "#aaa");
		},
		m(target, anchor) {
			insert_hydration(target, line, anchor);
		},
		p(ctx, dirty) {
			if (dirty[0] & /*x1*/ 65536) {
				attr(line, "x1", /*x1*/ ctx[16]);
			}

			if (dirty[0] & /*x1*/ 65536) {
				attr(line, "x2", /*x1*/ ctx[16]);
			}

			if (dirty[0] & /*tickVals, $yScale*/ 10240 && line_y__value !== (line_y__value = /*tickVals*/ ctx[11].map(/*$yScale*/ ctx[13])[0])) {
				attr(line, "y1", line_y__value);
			}

			if (dirty[0] & /*tickVals, $yScale*/ 10240 && line_y__value_1 !== (line_y__value_1 = /*tickVals*/ ctx[11].map(/*$yScale*/ ctx[13])[/*tickVals*/ ctx[11].length - 1])) {
				attr(line, "y2", line_y__value_1);
			}
		},
		d(detaching) {
			if (detaching) {
				detach(line);
			}
		}
	};
}

// (101:6) {#if gridlines === true}
function create_if_block_2$1(ctx) {
	let line;

	return {
		c() {
			line = svg_element("line");
			this.h();
		},
		l(nodes) {
			line = claim_svg_element(nodes, "line", {
				class: true,
				x1: true,
				x2: true,
				y1: true,
				y2: true
			});

			children(line).forEach(detach);
			this.h();
		},
		h() {
			attr(line, "class", "gridline svelte-zyly5l");
			attr(line, "x1", /*x1*/ ctx[16]);
			attr(line, "x2", /*$width*/ ctx[18]);
			attr(line, "y1", /*y*/ ctx[15]);
			attr(line, "y2", /*y*/ ctx[15]);
		},
		m(target, anchor) {
			insert_hydration(target, line, anchor);
		},
		p(ctx, dirty) {
			if (dirty[0] & /*x1*/ 65536) {
				attr(line, "x1", /*x1*/ ctx[16]);
			}

			if (dirty[0] & /*$width*/ 262144) {
				attr(line, "x2", /*$width*/ ctx[18]);
			}

			if (dirty[0] & /*y*/ 32768) {
				attr(line, "y1", /*y*/ ctx[15]);
			}

			if (dirty[0] & /*y*/ 32768) {
				attr(line, "y2", /*y*/ ctx[15]);
			}
		},
		d(detaching) {
			if (detaching) {
				detach(line);
			}
		}
	};
}

// (110:6) {#if tickMarks === true}
function create_if_block_1$1(ctx) {
	let line;
	let line_x__value;
	let line_y__value;

	return {
		c() {
			line = svg_element("line");
			this.h();
		},
		l(nodes) {
			line = claim_svg_element(nodes, "line", {
				class: true,
				x1: true,
				x2: true,
				y1: true,
				y2: true
			});

			children(line).forEach(detach);
			this.h();
		},
		h() {
			attr(line, "class", "tick-mark svelte-zyly5l");
			attr(line, "x1", /*x1*/ ctx[16]);
			attr(line, "x2", line_x__value = /*x1*/ ctx[16] + /*tickLen*/ ctx[12]);
			attr(line, "y1", line_y__value = /*tick*/ ctx[32].coord - /*tickValPx*/ ctx[33]);
			attr(line, "y2", /*y*/ ctx[15]);
		},
		m(target, anchor) {
			insert_hydration(target, line, anchor);
		},
		p(ctx, dirty) {
			if (dirty[0] & /*x1*/ 65536) {
				attr(line, "x1", /*x1*/ ctx[16]);
			}

			if (dirty[0] & /*x1, tickLen*/ 69632 && line_x__value !== (line_x__value = /*x1*/ ctx[16] + /*tickLen*/ ctx[12])) {
				attr(line, "x2", line_x__value);
			}

			if (dirty[0] & /*$yScale*/ 8192 | dirty[1] & /*d*/ 1 && line_y__value !== (line_y__value = /*tick*/ ctx[32].coord - /*tickValPx*/ ctx[33])) {
				attr(line, "y1", line_y__value);
			}

			if (dirty[0] & /*y*/ 32768) {
				attr(line, "y2", /*y*/ ctx[15]);
			}
		},
		d(detaching) {
			if (detaching) {
				detach(line);
			}
		}
	};
}

// (119:6) {#if tickLabel === true}
function create_if_block$2(ctx) {
	let text_1;

	let t_value = (/*tickMap*/ ctx[8]
	? /*tickMap*/ ctx[8].get(/*tick*/ ctx[32].d)
	: /*format*/ ctx[5](/*tick*/ ctx[32])) + "";

	let t;
	let text_1_y_value;
	let text_1_dx_value;
	let text_1_text_anchor_value;
	let text_1_dy_value;

	return {
		c() {
			text_1 = svg_element("text");
			t = text(t_value);
			this.h();
		},
		l(nodes) {
			text_1 = claim_svg_element(nodes, "text", {
				x: true,
				y: true,
				dx: true,
				"text-anchor": true,
				dy: true,
				class: true
			});

			var text_1_nodes = children(text_1);
			t = claim_text(text_1_nodes, t_value);
			text_1_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(text_1, "x", /*x1*/ ctx[16]);
			attr(text_1, "y", text_1_y_value = /*tick*/ ctx[32].coord - /*tickValPx*/ ctx[33]);
			attr(text_1, "dx", text_1_dx_value = /*dx*/ ctx[6] + (/*labelPosition*/ ctx[2] === 'even' ? -3 : 0));
			attr(text_1, "text-anchor", text_1_text_anchor_value = /*labelPosition*/ ctx[2] === 'above' ? 'start' : 'end');

			attr(text_1, "dy", text_1_dy_value = /*dy*/ ctx[7] + (/*labelPosition*/ ctx[2] === 'above' || /*snapBaselineLabel*/ ctx[3] === true && /*tickValPx*/ ctx[33] === /*maxTickValPx*/ ctx[14]
			? -3
			: 4));

			attr(text_1, "class", "svelte-zyly5l");
		},
		m(target, anchor) {
			insert_hydration(target, text_1, anchor);
			append_hydration(text_1, t);
		},
		p(ctx, dirty) {
			if (dirty[0] & /*tickMap, format*/ 288 | dirty[1] & /*d*/ 1 && t_value !== (t_value = (/*tickMap*/ ctx[8]
			? /*tickMap*/ ctx[8].get(/*tick*/ ctx[32].d)
			: /*format*/ ctx[5](/*tick*/ ctx[32])) + "")) set_data(t, t_value);

			if (dirty[0] & /*x1*/ 65536) {
				attr(text_1, "x", /*x1*/ ctx[16]);
			}

			if (dirty[0] & /*$yScale*/ 8192 | dirty[1] & /*d*/ 1 && text_1_y_value !== (text_1_y_value = /*tick*/ ctx[32].coord - /*tickValPx*/ ctx[33])) {
				attr(text_1, "y", text_1_y_value);
			}

			if (dirty[0] & /*dx, labelPosition*/ 68 && text_1_dx_value !== (text_1_dx_value = /*dx*/ ctx[6] + (/*labelPosition*/ ctx[2] === 'even' ? -3 : 0))) {
				attr(text_1, "dx", text_1_dx_value);
			}

			if (dirty[0] & /*labelPosition*/ 4 && text_1_text_anchor_value !== (text_1_text_anchor_value = /*labelPosition*/ ctx[2] === 'above' ? 'start' : 'end')) {
				attr(text_1, "text-anchor", text_1_text_anchor_value);
			}

			if (dirty[0] & /*dy, labelPosition, snapBaselineLabel, $yScale, maxTickValPx*/ 24716 | dirty[1] & /*d*/ 1 && text_1_dy_value !== (text_1_dy_value = /*dy*/ ctx[7] + (/*labelPosition*/ ctx[2] === 'above' || /*snapBaselineLabel*/ ctx[3] === true && /*tickValPx*/ ctx[33] === /*maxTickValPx*/ ctx[14]
			? -3
			: 4))) {
				attr(text_1, "dy", text_1_dy_value);
			}
		},
		d(detaching) {
			if (detaching) {
				detach(text_1);
			}
		}
	};
}

// (98:2) {#each d as tick,i (tick)}
function create_each_block$2(key_1, ctx) {
	let g;
	let if_block0_anchor;
	let if_block1_anchor;
	let g_class_value;
	let g_transform_value;
	let if_block0 = /*gridlines*/ ctx[4] === true && create_if_block_2$1(ctx);
	let if_block1 = /*tickMarks*/ ctx[0] === true && create_if_block_1$1(ctx);
	let if_block2 = /*tickLabel*/ ctx[1] === true && create_if_block$2(ctx);

	return {
		key: key_1,
		first: null,
		c() {
			g = svg_element("g");
			if (if_block0) if_block0.c();
			if_block0_anchor = empty();
			if (if_block1) if_block1.c();
			if_block1_anchor = empty();
			if (if_block2) if_block2.c();
			this.h();
		},
		l(nodes) {
			g = claim_svg_element(nodes, "g", { class: true, transform: true });
			var g_nodes = children(g);
			if (if_block0) if_block0.l(g_nodes);
			if_block0_anchor = empty();
			if (if_block1) if_block1.l(g_nodes);
			if_block1_anchor = empty();
			if (if_block2) if_block2.l(g_nodes);
			g_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(g, "class", g_class_value = "tick tick-" + /*tick*/ ctx[32] + " svelte-zyly5l");
			attr(g, "transform", g_transform_value = "translate(" + /*$xRange*/ ctx[17][0] + ", " + /*tickValPx*/ ctx[33] + ")");
			this.first = g;
		},
		m(target, anchor) {
			insert_hydration(target, g, anchor);
			if (if_block0) if_block0.m(g, null);
			append_hydration(g, if_block0_anchor);
			if (if_block1) if_block1.m(g, null);
			append_hydration(g, if_block1_anchor);
			if (if_block2) if_block2.m(g, null);
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;

			if (/*gridlines*/ ctx[4] === true) {
				if (if_block0) {
					if_block0.p(ctx, dirty);
				} else {
					if_block0 = create_if_block_2$1(ctx);
					if_block0.c();
					if_block0.m(g, if_block0_anchor);
				}
			} else if (if_block0) {
				if_block0.d(1);
				if_block0 = null;
			}

			if (/*tickMarks*/ ctx[0] === true) {
				if (if_block1) {
					if_block1.p(ctx, dirty);
				} else {
					if_block1 = create_if_block_1$1(ctx);
					if_block1.c();
					if_block1.m(g, if_block1_anchor);
				}
			} else if (if_block1) {
				if_block1.d(1);
				if_block1 = null;
			}

			if (/*tickLabel*/ ctx[1] === true) {
				if (if_block2) {
					if_block2.p(ctx, dirty);
				} else {
					if_block2 = create_if_block$2(ctx);
					if_block2.c();
					if_block2.m(g, null);
				}
			} else if (if_block2) {
				if_block2.d(1);
				if_block2 = null;
			}

			if (dirty[1] & /*d*/ 1 && g_class_value !== (g_class_value = "tick tick-" + /*tick*/ ctx[32] + " svelte-zyly5l")) {
				attr(g, "class", g_class_value);
			}

			if (dirty[0] & /*$xRange, $yScale*/ 139264 | dirty[1] & /*d*/ 1 && g_transform_value !== (g_transform_value = "translate(" + /*$xRange*/ ctx[17][0] + ", " + /*tickValPx*/ ctx[33] + ")")) {
				attr(g, "transform", g_transform_value);
			}
		},
		d(detaching) {
			if (detaching) {
				detach(g);
			}

			if (if_block0) if_block0.d();
			if (if_block1) if_block1.d();
			if (if_block2) if_block2.d();
		}
	};
}

// (96:0) <Dodger stack = {tickVals} let:d {offSet}  >
function create_default_slot$1(ctx) {
	let each_blocks = [];
	let each_1_lookup = new Map();
	let each_1_anchor;
	let each_value = ensure_array_like(/*d*/ ctx[31]);
	const get_key = ctx => /*tick*/ ctx[32];

	for (let i = 0; i < each_value.length; i += 1) {
		let child_ctx = get_each_context$2(ctx, each_value, i);
		let key = get_key(child_ctx);
		each_1_lookup.set(key, each_blocks[i] = create_each_block$2(key, child_ctx));
	}

	return {
		c() {
			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			each_1_anchor = empty();
		},
		l(nodes) {
			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(nodes);
			}

			each_1_anchor = empty();
		},
		m(target, anchor) {
			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(target, anchor);
				}
			}

			insert_hydration(target, each_1_anchor, anchor);
		},
		p(ctx, dirty) {
			if (dirty[0] & /*$xRange, $yScale, x1, dx, labelPosition, dy, snapBaselineLabel, maxTickValPx, tickMap, format, tickLabel, tickLen, y, tickMarks, $width, gridlines*/ 520703 | dirty[1] & /*d*/ 1) {
				each_value = ensure_array_like(/*d*/ ctx[31]);
				each_blocks = update_keyed_each(each_blocks, dirty, get_key, 1, ctx, each_value, each_1_lookup, each_1_anchor.parentNode, destroy_block, create_each_block$2, each_1_anchor, get_each_context$2);
			}
		},
		d(detaching) {
			if (detaching) {
				detach(each_1_anchor);
			}

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].d(detaching);
			}
		}
	};
}

function create_fragment$3(ctx) {
	let g;
	let if_block_anchor;
	let dodger;
	let current;
	let if_block = /*axisLine*/ ctx[9] && create_if_block_3(ctx);

	dodger = new Dodger({
			props: {
				stack: /*tickVals*/ ctx[11],
				offSet: /*offSet*/ ctx[10],
				$$slots: {
					default: [create_default_slot$1, ({ d }) => ({ 31: d }), ({ d }) => [0, d ? 1 : 0]]
				},
				$$scope: { ctx }
			}
		});

	return {
		c() {
			g = svg_element("g");
			if (if_block) if_block.c();
			if_block_anchor = empty();
			create_component(dodger.$$.fragment);
			this.h();
		},
		l(nodes) {
			g = claim_svg_element(nodes, "g", { class: true });
			var g_nodes = children(g);
			if (if_block) if_block.l(g_nodes);
			if_block_anchor = empty();
			claim_component(dodger.$$.fragment, g_nodes);
			g_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(g, "class", "axis y-axis");
		},
		m(target, anchor) {
			insert_hydration(target, g, anchor);
			if (if_block) if_block.m(g, null);
			append_hydration(g, if_block_anchor);
			mount_component(dodger, g, null);
			current = true;
		},
		p(ctx, dirty) {
			if (/*axisLine*/ ctx[9]) {
				if (if_block) {
					if_block.p(ctx, dirty);
				} else {
					if_block = create_if_block_3(ctx);
					if_block.c();
					if_block.m(g, if_block_anchor);
				}
			} else if (if_block) {
				if_block.d(1);
				if_block = null;
			}

			const dodger_changes = {};
			if (dirty[0] & /*tickVals*/ 2048) dodger_changes.stack = /*tickVals*/ ctx[11];
			if (dirty[0] & /*offSet*/ 1024) dodger_changes.offSet = /*offSet*/ ctx[10];

			if (dirty[0] & /*$xRange, $yScale, x1, dx, labelPosition, dy, snapBaselineLabel, maxTickValPx, tickMap, format, tickLabel, tickLen, y, tickMarks, $width, gridlines*/ 520703 | dirty[1] & /*$$scope, d*/ 33) {
				dodger_changes.$$scope = { dirty, ctx };
			}

			dodger.$set(dodger_changes);
		},
		i(local) {
			if (current) return;
			transition_in(dodger.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(dodger.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) {
				detach(g);
			}

			if (if_block) if_block.d();
			destroy_component(dodger);
		}
	};
}

function instance$4($$self, $$props, $$invalidate) {
	let isBandwidth;
	let tickVals;
	let tickLen;
	let widestTickLen;
	let x1;
	let y;
	let maxTickValPx;
	let $yScale;
	let $xRange;
	let $width;
	const { xRange, yRange, yScale, width } = getContext('LayerCake');
	component_subscribe($$self, xRange, value => $$invalidate(17, $xRange = value));
	component_subscribe($$self, yScale, value => $$invalidate(13, $yScale = value));
	component_subscribe($$self, width, value => $$invalidate(18, $width = value));
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

	$$self.$$set = $$props => {
		if ('tickMarks' in $$props) $$invalidate(0, tickMarks = $$props.tickMarks);
		if ('tickLabel' in $$props) $$invalidate(1, tickLabel = $$props.tickLabel);
		if ('labelPosition' in $$props) $$invalidate(2, labelPosition = $$props.labelPosition);
		if ('snapBaselineLabel' in $$props) $$invalidate(3, snapBaselineLabel = $$props.snapBaselineLabel);
		if ('gridlines' in $$props) $$invalidate(4, gridlines = $$props.gridlines);
		if ('tickMarkLength' in $$props) $$invalidate(22, tickMarkLength = $$props.tickMarkLength);
		if ('format' in $$props) $$invalidate(5, format = $$props.format);
		if ('ticks' in $$props) $$invalidate(23, ticks = $$props.ticks);
		if ('tickGutter' in $$props) $$invalidate(24, tickGutter = $$props.tickGutter);
		if ('dx' in $$props) $$invalidate(6, dx = $$props.dx);
		if ('dy' in $$props) $$invalidate(7, dy = $$props.dy);
		if ('offsetY' in $$props) $$invalidate(25, offsetY = $$props.offsetY);
		if ('charPixelWidth' in $$props) $$invalidate(26, charPixelWidth = $$props.charPixelWidth);
		if ('tickMap' in $$props) $$invalidate(8, tickMap = $$props.tickMap);
		if ('axisLine' in $$props) $$invalidate(9, axisLine = $$props.axisLine);
		if ('offSet' in $$props) $$invalidate(10, offSet = $$props.offSet);
	};

	$$self.$$.update = () => {
		if ($$self.$$.dirty[0] & /*$yScale*/ 8192) {
			$$invalidate(27, isBandwidth = typeof $yScale.bandwidth === 'function');
		}

		if ($$self.$$.dirty[0] & /*ticks, isBandwidth, $yScale*/ 142614528) {
			$$invalidate(11, tickVals = Array.isArray(ticks)
			? ticks
			: isBandwidth
				? $yScale.domain()
				: typeof ticks === 'function'
					? ticks($yScale.ticks())
					: $yScale.ticks(ticks));
		}

		if ($$self.$$.dirty[0] & /*tickVals, format*/ 2080) {
			$$invalidate(28, widestTickLen = Math.max(10, Math.max(...tickVals.map(d => format(d).toString().split('').reduce(calcStringLength, 0)))));
		}

		if ($$self.$$.dirty[0] & /*tickMarks, labelPosition, tickMarkLength, widestTickLen*/ 272629765) {
			$$invalidate(12, tickLen = tickMarks === true
			? labelPosition === 'above'
				? tickMarkLength ?? widestTickLen
				: tickMarkLength ?? 6
			: 0);
		}

		if ($$self.$$.dirty[0] & /*tickGutter, labelPosition, widestTickLen, tickLen*/ 285216772) {
			$$invalidate(16, x1 = -tickGutter - (labelPosition === 'above' ? widestTickLen : tickLen));
		}

		if ($$self.$$.dirty[0] & /*isBandwidth, $yScale*/ 134225920) {
			$$invalidate(15, y = isBandwidth ? $yScale.bandwidth() / 2 : 0);
		}

		if ($$self.$$.dirty[0] & /*tickVals, $yScale*/ 10240) {
			$$invalidate(14, maxTickValPx = Math.max(...tickVals.map($yScale)));
		}
	};

	return [
		tickMarks,
		tickLabel,
		labelPosition,
		snapBaselineLabel,
		gridlines,
		format,
		dx,
		dy,
		tickMap,
		axisLine,
		offSet,
		tickVals,
		tickLen,
		$yScale,
		maxTickValPx,
		y,
		x1,
		$xRange,
		$width,
		xRange,
		yScale,
		width,
		tickMarkLength,
		ticks,
		tickGutter,
		offsetY,
		charPixelWidth,
		isBandwidth,
		widestTickLen
	];
}

class AxisY extends SvelteComponent {
	constructor(options) {
		super();

		init(
			this,
			options,
			instance$4,
			create_fragment$3,
			safe_not_equal,
			{
				tickMarks: 0,
				tickLabel: 1,
				labelPosition: 2,
				snapBaselineLabel: 3,
				gridlines: 4,
				tickMarkLength: 22,
				format: 5,
				ticks: 23,
				tickGutter: 24,
				dx: 6,
				dy: 7,
				offsetY: 25,
				charPixelWidth: 26,
				tickMap: 8,
				axisLine: 9,
				offSet: 10
			},
			add_css$2,
			[-1, -1]
		);
	}
}

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

function instance$3($$self, $$props, $$invalidate) {
	let $yScale;
	let $xScale;
	const { data, x, width, height, xScale, xGet, y, yGet, yScale, zScale } = getContext('LayerCake');
	component_subscribe($$self, xScale, value => $$invalidate(6, $xScale = value));
	component_subscribe($$self, yScale, value => $$invalidate(5, $yScale = value));
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

	$$self.$$set = $$props => {
		if ('row' in $$props) $$invalidate(2, row = $$props.row);
		if ('strokeStyle' in $$props) $$invalidate(3, strokeStyle = $$props.strokeStyle);
		if ('a' in $$props) $$invalidate(4, a = $$props.a);
	};

	return [xScale, yScale, row, strokeStyle, a];
}

class Curve_canvas extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$3, null, safe_not_equal, { row: 2, strokeStyle: 3, a: 4 });
	}
}

/* src/routes/seqplot/stream/CanvasController.svelte generated by Svelte v4.2.9 */

function get_each_context$1(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[21] = list[i];
	return child_ctx;
}

// (48:0) {#if $ctx}
function create_if_block$1(ctx) {
	let each_blocks = [];
	let each_1_lookup = new Map();
	let each_1_anchor;
	let current;
	let each_value = ensure_array_like(/*$data*/ ctx[1]);
	const get_key = ctx => /*row*/ ctx[21].id;

	for (let i = 0; i < each_value.length; i += 1) {
		let child_ctx = get_each_context$1(ctx, each_value, i);
		let key = get_key(child_ctx);
		each_1_lookup.set(key, each_blocks[i] = create_each_block$1(key, child_ctx));
	}

	return {
		c() {
			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			each_1_anchor = empty();
		},
		l(nodes) {
			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(nodes);
			}

			each_1_anchor = empty();
		},
		m(target, anchor) {
			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(target, anchor);
				}
			}

			insert_hydration(target, each_1_anchor, anchor);
			current = true;
		},
		p(ctx, dirty) {
			if (dirty & /*$y, $data*/ 6) {
				each_value = ensure_array_like(/*$data*/ ctx[1]);
				group_outros();
				each_blocks = update_keyed_each(each_blocks, dirty, get_key, 1, ctx, each_value, each_1_lookup, each_1_anchor.parentNode, outro_and_destroy_block, create_each_block$1, each_1_anchor, get_each_context$1);
				check_outros();
			}
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},
		o(local) {
			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},
		d(detaching) {
			if (detaching) {
				detach(each_1_anchor);
			}

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].d(detaching);
			}
		}
	};
}

// (49:2) {#each $data as row (row.id )}
function create_each_block$1(key_1, ctx) {
	let first;
	let curve;
	let current;

	curve = new Curve_canvas({
			props: { row: /*$y*/ ctx[2](/*row*/ ctx[21]) }
		});

	return {
		key: key_1,
		first: null,
		c() {
			first = empty();
			create_component(curve.$$.fragment);
			this.h();
		},
		l(nodes) {
			first = empty();
			claim_component(curve.$$.fragment, nodes);
			this.h();
		},
		h() {
			this.first = first;
		},
		m(target, anchor) {
			insert_hydration(target, first, anchor);
			mount_component(curve, target, anchor);
			current = true;
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			const curve_changes = {};
			if (dirty & /*$y, $data*/ 6) curve_changes.row = /*$y*/ ctx[2](/*row*/ ctx[21]);
			curve.$set(curve_changes);
		},
		i(local) {
			if (current) return;
			transition_in(curve.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(curve.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) {
				detach(first);
			}

			destroy_component(curve, detaching);
		}
	};
}

function create_fragment$2(ctx) {
	let if_block_anchor;
	let current;
	let if_block = /*$ctx*/ ctx[0] && create_if_block$1(ctx);

	return {
		c() {
			if (if_block) if_block.c();
			if_block_anchor = empty();
		},
		l(nodes) {
			if (if_block) if_block.l(nodes);
			if_block_anchor = empty();
		},
		m(target, anchor) {
			if (if_block) if_block.m(target, anchor);
			insert_hydration(target, if_block_anchor, anchor);
			current = true;
		},
		p(ctx, [dirty]) {
			if (/*$ctx*/ ctx[0]) {
				if (if_block) {
					if_block.p(ctx, dirty);

					if (dirty & /*$ctx*/ 1) {
						transition_in(if_block, 1);
					}
				} else {
					if_block = create_if_block$1(ctx);
					if_block.c();
					transition_in(if_block, 1);
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			} else if (if_block) {
				group_outros();

				transition_out(if_block, 1, 1, () => {
					if_block = null;
				});

				check_outros();
			}
		},
		i(local) {
			if (current) return;
			transition_in(if_block);
			current = true;
		},
		o(local) {
			transition_out(if_block);
			current = false;
		},
		d(detaching) {
			if (detaching) {
				detach(if_block_anchor);
			}

			if (if_block) if_block.d(detaching);
		}
	};
}

function instance$2($$self, $$props, $$invalidate) {
	let $ctx;
	let $height;
	let $width;
	let $data;
	let $y;
	const { data, x, width, height, xScale, xGet, y, yGet, yScale, zScale } = getContext('LayerCake');
	component_subscribe($$self, data, value => $$invalidate(1, $data = value));
	component_subscribe($$self, width, value => $$invalidate(10, $width = value));
	component_subscribe($$self, height, value => $$invalidate(9, $height = value));
	component_subscribe($$self, y, value => $$invalidate(2, $y = value));
	const { ctx } = getContext('canvas');
	component_subscribe($$self, ctx, value => $$invalidate(0, $ctx = value));
	let items = new Set();
	let scheduled = false;
	setContext("canvas", { addItem });

	function addItem(fn) {
		onMount(() => {
			items.add(fn);

			return () => {
				console.log("deleted");
				return items.delete(fn);
			};
		}); //canvas lines become components. When svelte unmounts them they are deleted

		afterUpdate(async () => {
			if (scheduled) return;
			scheduled = true;

			//wait for all other line components to update the state, then draw
			await tick();

			scheduled = false;

			//draw()
			draw();
		});
	}

	function draw() {
		scaleCanvas($ctx, $width, $height);
		$ctx.clearRect(0, 0, $width, $height);

		//items.forEach(fn => fn($ctx));
		items.forEach(fn => fn($ctx));
	}

	return [$ctx, $data, $y, data, width, height, y, ctx];
}

class CanvasController extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance$2, create_fragment$2, safe_not_equal, {});
	}
}

/* src/routes/seqplot/stream/AxisX.svelte generated by Svelte v4.2.9 */

function add_css$1(target) {
	append_styles(target, "svelte-wr6453", ".tick.svelte-wr6453.svelte-wr6453{font-size:0.725em;font-weight:200}line.svelte-wr6453.svelte-wr6453,.tick.svelte-wr6453 line.svelte-wr6453{stroke:#aaa;stroke-dasharray:2}.tick.svelte-wr6453 text.svelte-wr6453{fill:#666}.tick.svelte-wr6453 .tick-mark.svelte-wr6453,.baseline.svelte-wr6453.svelte-wr6453{stroke-dasharray:0}.axis.snapTicks.svelte-wr6453 .tick:last-child text.svelte-wr6453{transform:translateX(3px)}.axis.snapTicks.svelte-wr6453 .tick.tick-0 text.svelte-wr6453{transform:translateX(-3px)}");
}

function get_each_context(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[19] = list[i];
	child_ctx[21] = i;
	return child_ctx;
}

// (58:6) {#if gridlines !== false}
function create_if_block_2(ctx) {
	let line;
	let line_y__value;

	return {
		c() {
			line = svg_element("line");
			this.h();
		},
		l(nodes) {
			line = claim_svg_element(nodes, "line", {
				class: true,
				y1: true,
				y2: true,
				x1: true,
				x2: true
			});

			children(line).forEach(detach);
			this.h();
		},
		h() {
			attr(line, "class", "gridline svelte-wr6453");
			attr(line, "y1", line_y__value = /*$height*/ ctx[11] * -1);
			attr(line, "y2", "0");
			attr(line, "x1", "0");
			attr(line, "x2", "0");
		},
		m(target, anchor) {
			insert_hydration(target, line, anchor);
		},
		p(ctx, dirty) {
			if (dirty & /*$height*/ 2048 && line_y__value !== (line_y__value = /*$height*/ ctx[11] * -1)) {
				attr(line, "y1", line_y__value);
			}
		},
		d(detaching) {
			if (detaching) {
				detach(line);
			}
		}
	};
}

// (61:6) {#if tickMarks === true}
function create_if_block_1(ctx) {
	let line;
	let line_x__value;
	let line_x__value_1;

	return {
		c() {
			line = svg_element("line");
			this.h();
		},
		l(nodes) {
			line = claim_svg_element(nodes, "line", {
				class: true,
				y1: true,
				y2: true,
				x1: true,
				x2: true
			});

			children(line).forEach(detach);
			this.h();
		},
		h() {
			attr(line, "class", "tick-mark svelte-wr6453");
			attr(line, "y1", 0);
			attr(line, "y2", 6);

			attr(line, "x1", line_x__value = /*isBandwidth*/ ctx[7]
			? /*$xScale*/ ctx[8].bandwidth() / 2
			: 0);

			attr(line, "x2", line_x__value_1 = /*isBandwidth*/ ctx[7]
			? /*$xScale*/ ctx[8].bandwidth() / 2
			: 0);
		},
		m(target, anchor) {
			insert_hydration(target, line, anchor);
		},
		p(ctx, dirty) {
			if (dirty & /*isBandwidth, $xScale*/ 384 && line_x__value !== (line_x__value = /*isBandwidth*/ ctx[7]
			? /*$xScale*/ ctx[8].bandwidth() / 2
			: 0)) {
				attr(line, "x1", line_x__value);
			}

			if (dirty & /*isBandwidth, $xScale*/ 384 && line_x__value_1 !== (line_x__value_1 = /*isBandwidth*/ ctx[7]
			? /*$xScale*/ ctx[8].bandwidth() / 2
			: 0)) {
				attr(line, "x2", line_x__value_1);
			}
		},
		d(detaching) {
			if (detaching) {
				detach(line);
			}
		}
	};
}

// (56:2) {#each tickVals as tick, i (tick)}
function create_each_block(key_1, ctx) {
	let g;
	let if_block0_anchor;
	let text_1;
	let t_value = /*formatTick*/ ctx[4](/*tick*/ ctx[19]) + "";
	let t;
	let text_1_x_value;
	let text_1_text_anchor_value;
	let g_class_value;
	let g_transform_value;
	let if_block0 = /*gridlines*/ ctx[0] !== false && create_if_block_2(ctx);
	let if_block1 = /*tickMarks*/ ctx[1] === true && create_if_block_1(ctx);

	return {
		key: key_1,
		first: null,
		c() {
			g = svg_element("g");
			if (if_block0) if_block0.c();
			if_block0_anchor = empty();
			if (if_block1) if_block1.c();
			text_1 = svg_element("text");
			t = text(t_value);
			this.h();
		},
		l(nodes) {
			g = claim_svg_element(nodes, "g", { class: true, transform: true });
			var g_nodes = children(g);
			if (if_block0) if_block0.l(g_nodes);
			if_block0_anchor = empty();
			if (if_block1) if_block1.l(g_nodes);

			text_1 = claim_svg_element(g_nodes, "text", {
				x: true,
				y: true,
				dx: true,
				dy: true,
				"text-anchor": true,
				class: true
			});

			var text_1_nodes = children(text_1);
			t = claim_text(text_1_nodes, t_value);
			text_1_nodes.forEach(detach);
			g_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(text_1, "x", text_1_x_value = /*isBandwidth*/ ctx[7]
			? +/*xTick*/ ctx[5]
			: /*xTick*/ ctx[5]);

			attr(text_1, "y", /*yTick*/ ctx[6]);
			attr(text_1, "dx", "");
			attr(text_1, "dy", "");
			attr(text_1, "text-anchor", text_1_text_anchor_value = /*textAnchor*/ ctx[17](/*i*/ ctx[21]));
			attr(text_1, "class", "svelte-wr6453");
			attr(g, "class", g_class_value = "tick tick-" + /*i*/ ctx[21] + " svelte-wr6453");
			attr(g, "transform", g_transform_value = "translate(" + /*$xScale*/ ctx[8](/*tick*/ ctx[19]) + "," + Math.max(.../*$yRange*/ ctx[10]) + ")");
			this.first = g;
		},
		m(target, anchor) {
			insert_hydration(target, g, anchor);
			if (if_block0) if_block0.m(g, null);
			append_hydration(g, if_block0_anchor);
			if (if_block1) if_block1.m(g, null);
			append_hydration(g, text_1);
			append_hydration(text_1, t);
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;

			if (/*gridlines*/ ctx[0] !== false) {
				if (if_block0) {
					if_block0.p(ctx, dirty);
				} else {
					if_block0 = create_if_block_2(ctx);
					if_block0.c();
					if_block0.m(g, if_block0_anchor);
				}
			} else if (if_block0) {
				if_block0.d(1);
				if_block0 = null;
			}

			if (/*tickMarks*/ ctx[1] === true) {
				if (if_block1) {
					if_block1.p(ctx, dirty);
				} else {
					if_block1 = create_if_block_1(ctx);
					if_block1.c();
					if_block1.m(g, text_1);
				}
			} else if (if_block1) {
				if_block1.d(1);
				if_block1 = null;
			}

			if (dirty & /*formatTick, tickVals*/ 528 && t_value !== (t_value = /*formatTick*/ ctx[4](/*tick*/ ctx[19]) + "")) set_data(t, t_value);

			if (dirty & /*isBandwidth, xTick*/ 160 && text_1_x_value !== (text_1_x_value = /*isBandwidth*/ ctx[7]
			? +/*xTick*/ ctx[5]
			: /*xTick*/ ctx[5])) {
				attr(text_1, "x", text_1_x_value);
			}

			if (dirty & /*yTick*/ 64) {
				attr(text_1, "y", /*yTick*/ ctx[6]);
			}

			if (dirty & /*tickVals*/ 512 && text_1_text_anchor_value !== (text_1_text_anchor_value = /*textAnchor*/ ctx[17](/*i*/ ctx[21]))) {
				attr(text_1, "text-anchor", text_1_text_anchor_value);
			}

			if (dirty & /*tickVals*/ 512 && g_class_value !== (g_class_value = "tick tick-" + /*i*/ ctx[21] + " svelte-wr6453")) {
				attr(g, "class", g_class_value);
			}

			if (dirty & /*$xScale, tickVals, $yRange*/ 1792 && g_transform_value !== (g_transform_value = "translate(" + /*$xScale*/ ctx[8](/*tick*/ ctx[19]) + "," + Math.max(.../*$yRange*/ ctx[10]) + ")")) {
				attr(g, "transform", g_transform_value);
			}
		},
		d(detaching) {
			if (detaching) {
				detach(g);
			}

			if (if_block0) if_block0.d();
			if (if_block1) if_block1.d();
		}
	};
}

// (79:2) {#if baseline === true}
function create_if_block(ctx) {
	let line;
	let line_y__value;
	let line_y__value_1;

	return {
		c() {
			line = svg_element("line");
			this.h();
		},
		l(nodes) {
			line = claim_svg_element(nodes, "line", {
				class: true,
				y1: true,
				y2: true,
				x1: true,
				x2: true
			});

			children(line).forEach(detach);
			this.h();
		},
		h() {
			attr(line, "class", "baseline svelte-wr6453");
			attr(line, "y1", line_y__value = /*$height*/ ctx[11] + 0.5);
			attr(line, "y2", line_y__value_1 = /*$height*/ ctx[11] + 0.5);
			attr(line, "x1", "0");
			attr(line, "x2", /*$width*/ ctx[12]);
		},
		m(target, anchor) {
			insert_hydration(target, line, anchor);
		},
		p(ctx, dirty) {
			if (dirty & /*$height*/ 2048 && line_y__value !== (line_y__value = /*$height*/ ctx[11] + 0.5)) {
				attr(line, "y1", line_y__value);
			}

			if (dirty & /*$height*/ 2048 && line_y__value_1 !== (line_y__value_1 = /*$height*/ ctx[11] + 0.5)) {
				attr(line, "y2", line_y__value_1);
			}

			if (dirty & /*$width*/ 4096) {
				attr(line, "x2", /*$width*/ ctx[12]);
			}
		},
		d(detaching) {
			if (detaching) {
				detach(line);
			}
		}
	};
}

function create_fragment$1(ctx) {
	let g;
	let each_blocks = [];
	let each_1_lookup = new Map();
	let each_1_anchor;
	let each_value = ensure_array_like(/*tickVals*/ ctx[9]);
	const get_key = ctx => /*tick*/ ctx[19];

	for (let i = 0; i < each_value.length; i += 1) {
		let child_ctx = get_each_context(ctx, each_value, i);
		let key = get_key(child_ctx);
		each_1_lookup.set(key, each_blocks[i] = create_each_block(key, child_ctx));
	}

	let if_block = /*baseline*/ ctx[2] === true && create_if_block(ctx);

	return {
		c() {
			g = svg_element("g");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			each_1_anchor = empty();
			if (if_block) if_block.c();
			this.h();
		},
		l(nodes) {
			g = claim_svg_element(nodes, "g", { class: true });
			var g_nodes = children(g);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].l(g_nodes);
			}

			each_1_anchor = empty();
			if (if_block) if_block.l(g_nodes);
			g_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(g, "class", "axis x-axis svelte-wr6453");
			toggle_class(g, "snapTicks", /*snapTicks*/ ctx[3]);
		},
		m(target, anchor) {
			insert_hydration(target, g, anchor);

			for (let i = 0; i < each_blocks.length; i += 1) {
				if (each_blocks[i]) {
					each_blocks[i].m(g, null);
				}
			}

			append_hydration(g, each_1_anchor);
			if (if_block) if_block.m(g, null);
		},
		p(ctx, [dirty]) {
			if (dirty & /*tickVals, $xScale, Math, $yRange, isBandwidth, xTick, yTick, textAnchor, formatTick, tickMarks, $height, gridlines*/ 135155) {
				each_value = ensure_array_like(/*tickVals*/ ctx[9]);
				each_blocks = update_keyed_each(each_blocks, dirty, get_key, 1, ctx, each_value, each_1_lookup, g, destroy_block, create_each_block, each_1_anchor, get_each_context);
			}

			if (/*baseline*/ ctx[2] === true) {
				if (if_block) {
					if_block.p(ctx, dirty);
				} else {
					if_block = create_if_block(ctx);
					if_block.c();
					if_block.m(g, null);
				}
			} else if (if_block) {
				if_block.d(1);
				if_block = null;
			}

			if (dirty & /*snapTicks*/ 8) {
				toggle_class(g, "snapTicks", /*snapTicks*/ ctx[3]);
			}
		},
		i: noop,
		o: noop,
		d(detaching) {
			if (detaching) {
				detach(g);
			}

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].d();
			}

			if (if_block) if_block.d();
		}
	};
}

function instance$1($$self, $$props, $$invalidate) {
	let isBandwidth;
	let tickVals;
	let $xScale;
	let $yRange;
	let $height;
	let $width;
	const { width, height, xScale, yRange } = getContext('LayerCake');
	component_subscribe($$self, width, value => $$invalidate(12, $width = value));
	component_subscribe($$self, height, value => $$invalidate(11, $height = value));
	component_subscribe($$self, xScale, value => $$invalidate(8, $xScale = value));
	component_subscribe($$self, yRange, value => $$invalidate(10, $yRange = value));
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

	$$self.$$set = $$props => {
		if ('gridlines' in $$props) $$invalidate(0, gridlines = $$props.gridlines);
		if ('tickMarks' in $$props) $$invalidate(1, tickMarks = $$props.tickMarks);
		if ('baseline' in $$props) $$invalidate(2, baseline = $$props.baseline);
		if ('snapTicks' in $$props) $$invalidate(3, snapTicks = $$props.snapTicks);
		if ('formatTick' in $$props) $$invalidate(4, formatTick = $$props.formatTick);
		if ('ticks' in $$props) $$invalidate(18, ticks = $$props.ticks);
		if ('xTick' in $$props) $$invalidate(5, xTick = $$props.xTick);
		if ('yTick' in $$props) $$invalidate(6, yTick = $$props.yTick);
	};

	$$self.$$.update = () => {
		if ($$self.$$.dirty & /*$xScale*/ 256) {
			$$invalidate(7, isBandwidth = typeof $xScale.bandwidth === 'function');
		}

		if ($$self.$$.dirty & /*ticks, isBandwidth, $xScale*/ 262528) {
			$$invalidate(9, tickVals = Array.isArray(ticks)
			? ticks
			: isBandwidth
				? $xScale.domain()
				: typeof ticks === 'function'
					? ticks($xScale.ticks())
					: $xScale.ticks(ticks));
		}
	};

	return [
		gridlines,
		tickMarks,
		baseline,
		snapTicks,
		formatTick,
		xTick,
		yTick,
		isBandwidth,
		$xScale,
		tickVals,
		$yRange,
		$height,
		$width,
		width,
		height,
		xScale,
		yRange,
		textAnchor,
		ticks
	];
}

class AxisX extends SvelteComponent {
	constructor(options) {
		super();

		init(
			this,
			options,
			instance$1,
			create_fragment$1,
			safe_not_equal,
			{
				gridlines: 0,
				tickMarks: 1,
				baseline: 2,
				snapTicks: 3,
				formatTick: 4,
				ticks: 18,
				xTick: 5,
				yTick: 6
			},
			add_css$1
		);
	}
}

/* src/routes/seqplot/stream/Stream.svelte generated by Svelte v4.2.9 */

function add_css(target) {
	append_styles(target, "svelte-1rhinkp", ".chart-container.svelte-1rhinkp{width:100%;height:700px}");
}

// (231:2) <Canvas>
function create_default_slot_2(ctx) {
	let canvascontroller;
	let current;
	canvascontroller = new CanvasController({});

	return {
		c() {
			create_component(canvascontroller.$$.fragment);
		},
		l(nodes) {
			claim_component(canvascontroller.$$.fragment, nodes);
		},
		m(target, anchor) {
			mount_component(canvascontroller, target, anchor);
			current = true;
		},
		i(local) {
			if (current) return;
			transition_in(canvascontroller.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(canvascontroller.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			destroy_component(canvascontroller, detaching);
		}
	};
}

// (234:2) <Svg>
function create_default_slot_1(ctx) {
	let axisy0;
	let t0;
	let axisy1;
	let t1;
	let axisx;
	let current;

	axisy0 = new AxisY({
			props: {
				tickMarks: true,
				snapLabels: true,
				gridlines: true,
				tickMarkLength: 20,
				tickGutter: 3,
				ticks: [0].concat(/*catSpan*/ ctx[2].map(func)),
				axisLine: true
			}
		});

	axisy1 = new AxisY({
			props: {
				tickMarks: true,
				offSet: 13,
				snapLabels: true,
				gridlines: false,
				tickMarkLength: 10,
				tickGutter: 25,
				tickLabel: true,
				format: func_1,
				ticks: /*catSpan*/ ctx[2].map(func_2),
				tickMap: new Map(/*catSpan*/ ctx[2].map(func_3))
			}
		});

	axisx = new AxisX({});

	return {
		c() {
			create_component(axisy0.$$.fragment);
			t0 = space();
			create_component(axisy1.$$.fragment);
			t1 = space();
			create_component(axisx.$$.fragment);
		},
		l(nodes) {
			claim_component(axisy0.$$.fragment, nodes);
			t0 = claim_space(nodes);
			claim_component(axisy1.$$.fragment, nodes);
			t1 = claim_space(nodes);
			claim_component(axisx.$$.fragment, nodes);
		},
		m(target, anchor) {
			mount_component(axisy0, target, anchor);
			insert_hydration(target, t0, anchor);
			mount_component(axisy1, target, anchor);
			insert_hydration(target, t1, anchor);
			mount_component(axisx, target, anchor);
			current = true;
		},
		p(ctx, dirty) {
			const axisy0_changes = {};
			if (dirty & /*catSpan*/ 4) axisy0_changes.ticks = [0].concat(/*catSpan*/ ctx[2].map(func));
			axisy0.$set(axisy0_changes);
			const axisy1_changes = {};
			if (dirty & /*catSpan*/ 4) axisy1_changes.ticks = /*catSpan*/ ctx[2].map(func_2);
			if (dirty & /*catSpan*/ 4) axisy1_changes.tickMap = new Map(/*catSpan*/ ctx[2].map(func_3));
			axisy1.$set(axisy1_changes);
		},
		i(local) {
			if (current) return;
			transition_in(axisy0.$$.fragment, local);
			transition_in(axisy1.$$.fragment, local);
			transition_in(axisx.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(axisy0.$$.fragment, local);
			transition_out(axisy1.$$.fragment, local);
			transition_out(axisx.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) {
				detach(t0);
				detach(t1);
			}

			destroy_component(axisy0, detaching);
			destroy_component(axisy1, detaching);
			destroy_component(axisx, detaching);
		}
	};
}

// (220:2) <LayerCake     padding={{ top: 20, right: 10, bottom: 20, left: 120 }}     data={$tweenedData}     y = {d => yKey.map(key => {return {x:d[key].time, y:d[key][yKeyType], state:d[key].state  }} ) }     yDomain={yDomain}     xScale={scaleBand()}     xDomain = {yKey}     zScale={scaleOrdinal()}     zDomain = {alphabet}     zRange = {colorMap}   >
function create_default_slot(ctx) {
	let canvas;
	let t;
	let svg;
	let current;

	canvas = new Canvas({
			props: {
				$$slots: { default: [create_default_slot_2] },
				$$scope: { ctx }
			}
		});

	svg = new Svg({
			props: {
				$$slots: { default: [create_default_slot_1] },
				$$scope: { ctx }
			}
		});

	return {
		c() {
			create_component(canvas.$$.fragment);
			t = space();
			create_component(svg.$$.fragment);
		},
		l(nodes) {
			claim_component(canvas.$$.fragment, nodes);
			t = claim_space(nodes);
			claim_component(svg.$$.fragment, nodes);
		},
		m(target, anchor) {
			mount_component(canvas, target, anchor);
			insert_hydration(target, t, anchor);
			mount_component(svg, target, anchor);
			current = true;
		},
		p(ctx, dirty) {
			const canvas_changes = {};

			if (dirty & /*$$scope*/ 8388608) {
				canvas_changes.$$scope = { dirty, ctx };
			}

			canvas.$set(canvas_changes);
			const svg_changes = {};

			if (dirty & /*$$scope, catSpan*/ 8388612) {
				svg_changes.$$scope = { dirty, ctx };
			}

			svg.$set(svg_changes);
		},
		i(local) {
			if (current) return;
			transition_in(canvas.$$.fragment, local);
			transition_in(svg.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(canvas.$$.fragment, local);
			transition_out(svg.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) {
				detach(t);
			}

			destroy_component(canvas, detaching);
			destroy_component(svg, detaching);
		}
	};
}

function create_fragment(ctx) {
	let div;
	let layercake;
	let current;

	layercake = new LayerCake({
			props: {
				padding: {
					top: 20,
					right: 10,
					bottom: 20,
					left: 120
				},
				data: /*$tweenedData*/ ctx[4],
				y: /*func_4*/ ctx[15],
				yDomain: /*yDomain*/ ctx[3],
				xScale: band(),
				xDomain: /*yKey*/ ctx[0],
				zScale: ordinal(),
				zDomain: /*alphabet*/ ctx[1],
				zRange: /*colorMap*/ ctx[5],
				$$slots: { default: [create_default_slot] },
				$$scope: { ctx }
			}
		});

	return {
		c() {
			div = element("div");
			create_component(layercake.$$.fragment);
			this.h();
		},
		l(nodes) {
			div = claim_element(nodes, "DIV", { class: true });
			var div_nodes = children(div);
			claim_component(layercake.$$.fragment, div_nodes);
			div_nodes.forEach(detach);
			this.h();
		},
		h() {
			attr(div, "class", "chart-container svelte-1rhinkp");
		},
		m(target, anchor) {
			insert_hydration(target, div, anchor);
			mount_component(layercake, div, null);
			current = true;
		},
		p(ctx, [dirty]) {
			const layercake_changes = {};
			if (dirty & /*$tweenedData*/ 16) layercake_changes.data = /*$tweenedData*/ ctx[4];
			if (dirty & /*yKey*/ 1) layercake_changes.y = /*func_4*/ ctx[15];
			if (dirty & /*yDomain*/ 8) layercake_changes.yDomain = /*yDomain*/ ctx[3];
			if (dirty & /*yKey*/ 1) layercake_changes.xDomain = /*yKey*/ ctx[0];
			if (dirty & /*alphabet*/ 2) layercake_changes.zDomain = /*alphabet*/ ctx[1];

			if (dirty & /*$$scope, catSpan*/ 8388612) {
				layercake_changes.$$scope = { dirty, ctx };
			}

			layercake.$set(layercake_changes);
		},
		i(local) {
			if (current) return;
			transition_in(layercake.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(layercake.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) {
				detach(div);
			}

			destroy_component(layercake);
		}
	};
}

let yKeyType = "wide";
const func = d => d[1];
const func_1 = (d, i) => d;
const func_2 = d => d[1] - d[2] * 0.5;
const func_3 = d => [d[1] - d[2] * 0.5, d[3]];

function instance($$self, $$props, $$invalidate) {
	let yDomainMax;
	let yDomain;
	let $tweenedData;
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

		$$invalidate(2, catSpan = alphabet.map((d, i) => [d, maxState[i + 1].stacked, maxState[i + 1].count, labels[i]]));
		catMap = new Map(yKey.map(t => [t, new Map(catSpan.map(d => [d[0], { stacked: d[1], unstacked: d[2] }]))]));

		$$invalidate(13, newData = data.map((obj, i) => {
			obj.index = i;
			let d = { ...obj };

			yKey.map(key => d[key] = {
				state: d[key],
				dense: stateStack.get(key)[0].get(d[key]).stacked++,
				time: key,
				wide: catMap.get(key).get(d[key]).stacked-- - (catMap.get(key).get(d[key]).unstacked - stateStack.get(key)[1].get(d[key])) * positionScaler
			});

			return d;
		}));
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

	component_subscribe($$self, tweenedData, value => $$invalidate(4, $tweenedData = value));

	const func_4 = d => yKey.map(key => {
		return {
			x: d[key].time,
			y: d[key][yKeyType],
			state: d[key].state
		};
	});

	$$self.$$set = $$props => {
		if ('position' in $$props) $$invalidate(7, position = $$props.position);
		if ('yKey' in $$props) $$invalidate(0, yKey = $$props.yKey);
		if ('data' in $$props) $$invalidate(8, data = $$props.data);
		if ('alphabet' in $$props) $$invalidate(1, alphabet = $$props.alphabet);
		if ('cpal' in $$props) $$invalidate(9, cpal = $$props.cpal);
		if ('labels' in $$props) $$invalidate(10, labels = $$props.labels);
		if ('ids' in $$props) $$invalidate(11, ids = $$props.ids);
		if ('margins' in $$props) $$invalidate(12, margins = $$props.margins);
	};

	$$self.$$.update = () => {
		if ($$self.$$.dirty & /*newData, yKey*/ 8193) {
			$$invalidate(14, yDomainMax = max(newData.map(d => yKey.map(key => d[key][yKeyType])).flat()));
		}

		if ($$self.$$.dirty & /*margins, yDomainMax*/ 20480) {
			$$invalidate(3, yDomain = [-margins[2], yDomainMax + margins[0]]);
		}
	};

	return [
		yKey,
		alphabet,
		catSpan,
		yDomain,
		$tweenedData,
		colorMap,
		tweenedData,
		position,
		data,
		cpal,
		labels,
		ids,
		margins,
		newData,
		yDomainMax,
		func_4
	];
}

class Stream extends SvelteComponent {
	constructor(options) {
		super();

		init(
			this,
			options,
			instance,
			create_fragment,
			safe_not_equal,
			{
				position: 7,
				yKey: 0,
				data: 8,
				alphabet: 1,
				cpal: 9,
				labels: 10,
				ids: 11,
				margins: 12
			},
			add_css
		);
	}
}

module.exports = Stream;
