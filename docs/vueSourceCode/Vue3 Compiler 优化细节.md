---
sidebarDepth: 0
---

# Vue3 Compiler 优化细节

[渲染机制 ｜ Vue.js](https://cn.vuejs.org/guide/extras/rendering-mechanism.html#compiler-informed-virtual-dom)

[Vue Template Explorer](https://template-explorer.vuejs.org/#eyJzcmMiOiI8ZGl2PlxyXG4gIDxkaXY+c3RhdGljPC9kaXY+XHJcbiAgPGRpdj57eyB0aXRsZSB9fTwvZGl2PlxyXG48L2Rpdj4iLCJvcHRpb25zIjp7fX0=)

参考源码：

1. packages/runtime-core/src/renderer.ts
2. packages/runtime-core/src/componentRenderUtils.ts
3. packages/runtime-core/src/vnode.ts

![PatchFlags Code](./images/PatchFlags.png)

## Block、Block Tree 和 PatchFlags 是什么

### Block

Block 是一组在同一作用域内的虚拟节点(VNode)。

在 Vue 3 中,使用 openBlock() 和 closeBlock() 来开启和关闭一个 Block:

```ts
openBlock()
// 一些创建 VNode 的代码
closeBlock()
```

### Block Tree

Block Tree 是嵌套的 Block 构成的树结构。outerBlock 包含 innerBlock: 其中,innerBlock 是一个 Block,outerBlock 包含 innerBlock,两者构成了一个 Block Tree。

```ts
openBlock() // outerBlock
  openBlock() // innerBlock
  closeBlock()
closeBlock()
```

### Block Block Tree 的作用

1. 方便对比同一 Block 内 VNode 的变化,避免不必要的跨 Block 比对。
2. 使得虚拟 DOM 的比较可以分块进行,提高效率。
3. 可以方便地知道一个 VNode 属于哪个 Block,从而得到该 VNode 在代码中的位置信息。
4. 有利于实现一些块级作用域的特性,如 v-once。


### PatchFlags

- 标记 VNode 在不同情况下的 patch 策略,避免不必要的 vdom 对比。
- 编码虚拟节点的特定信息,在 patch 过程中进行解码访问。

在 createVNode 的时候如果满足如下条件，会给当前 VNode 打上对应的 PatchFlag 标记

```ts
createVNode(div, null, 'text', PatchFlag.TEXT)
```

## Block VNode 是如何创建的

template

```html
<div id="demo">
  <h1>{{ title }}</h1>
</div>
```

[Vue Template Explorer](https://template-explorer.vuejs.org/#eyJzcmMiOiI8ZGl2PlxyXG4gIDxkaXY+c3RhdGljPC9kaXY+XHJcbiAgPGRpdj57eyB0aXRsZSB9fTwvZGl2PlxyXG48L2Rpdj4iLCJvcHRpb25zIjp7fX0=)

```ts
import { toDisplayString as _toDisplayString, createElementVNode as _createElementVNode, openBlock as _openBlock, createElementBlock as _createElementBlock } from "vue"

export function render(_ctx, _cache, $props, $setup, $data, $options) {
  return (_openBlock(), _createElementBlock("div", { id: "demo" }, [
    _createElementVNode("h1", null, _toDisplayString(_ctx.title), 1 /* TEXT */)
  ]))
}
```

Block VNode 是「Vue3」针对靶向更新而提出的概念，它的本质是动态节点对应的 VNode。而，VNode 上的 dynamicChildren 属性则是衍生于 Block VNode，因此，它也就是充当着靶向更新中的靶的角色。

### openBlock

openBlock 会为当前 Vnode 初始化一个数组 currentBlock 来存放 Block。

```ts
// 当为 v-for 时 disableTracking 为 true，v-for 需要进行完整的 diff
export function openBlock(disableTracking = false) {
  blockStack.push((currentBlock = disableTracking ? null : []))
}
```

### createElementVNode

其实不论是  createElementVNode 还是 createBlock 最终都是调用 createBaseVNode 来创建 Block VNode

```ts
export function createElementBlock(
  type: string | typeof Fragment,
  props?: Record<string, any> | null,
  children?: any,
  patchFlag?: number,
  dynamicProps?: string[],
  shapeFlag?: number
) {
  return setupBlock(
    createBaseVNode(
      type,
      props,
      children,
      patchFlag,
      dynamicProps,
      shapeFlag,
      true /* isBlock */
    )
  )
}
```

createBaseVNode：

```ts
function createBaseVNode(
  type: VNodeTypes | ClassComponent | typeof NULL_DYNAMIC_COMPONENT,
  props: (Data & VNodeProps) | null = null,
  children: unknown = null,
  patchFlag = 0,
  dynamicProps: string[] | null = null,
  shapeFlag = type === Fragment ? 0 : ShapeFlags.ELEMENT,
  isBlockNode = false,
  needFullChildrenNormalization = false
): VNode {
  // track vnode for block tree
  if (
    isBlockTreeEnabled > 0 &&
    // avoid a block node from tracking itself
    !isBlockNode &&
    // has current parent block
    currentBlock &&
    // presence of a patch flag indicates this node needs patching on updates.
    // component nodes also should always be patched, because even if the
    // component doesn't need to update, it needs to persist the instance on to
    // the next vnode so that it can be properly unmounted later.
    (vnode.patchFlag > 0 || shapeFlag & ShapeFlags.COMPONENT) &&
    // the EVENTS flag is only for hydration and if it is the only flag, the
    // vnode should not be considered dynamic due to handler caching.
    vnode.patchFlag !== PatchFlags.HYDRATE_EVENTS
  ) {
    currentBlock.push(vnode)
  }
}
```

- isBlockNode 是否为 Block Node。
- currentBlock 为数组时才创建 Block Node，对于 v-for 场景下，curretBlock 为 null，它不需要靶向更新。
- patchFlag 有意义且不为 32 事件监听，只有事件监听情况时事件监听会被缓存。
- shapeFlags 是组件的时候，必须为 Block Node，这是为了保证下一个 VNode 的正常卸载。

## Block 配合 PatchFlags 做到靶向更新

我们先来看这样一段代码：

```html
<div>
  <div>static</div>
  <div>{{ title }}</div>
</div>
```

在这段模板中，只有 `<div>{ title }</div>` 是动态的，因此靶向更新只需要更新该文本节点即可。而 `<div>static</div>`  会被当做静态节点处理，后续的更新不会包含该节点，这也是 Vue3 性能优于 Vue2 的一个原因。

经过 [Vue Template Explorer](https://template-explorer.vuejs.org/#eyJzcmMiOiI8ZGl2PlxyXG4gIDxkaXY+c3RhdGljPC9kaXY+XHJcbiAgPGRpdj57eyB0aXRsZSB9fTwvZGl2PlxyXG48L2Rpdj4iLCJvcHRpb25zIjp7fX0=) 编译后：

```ts
import { createElementVNode as _createElementVNode, toDisplayString as _toDisplayString, openBlock as _openBlock, createElementBlock as _createElementBlock } from "vue"

export function render(_ctx, _cache, $props, $setup, $data, $options) {
  return (_openBlock(), _createElementBlock("div", null, [
    _createElementVNode("div", null, "static"),
    _createElementVNode("div", null, _toDisplayString(_ctx.title), 1 /* TEXT */)
  ]))
}
// Check the console for the AST
```

通过编译后的代码，我们可以看出，title 已经被标记为 PatchFlag = 1 的动态节点，此时我们可以想像一下此时的 vdom 树的大概样子：

```ts
const vnode = {
  type: 'div',
  children: [
    { type: 'div', children: 'static' },
    { type: 'div', children: ctx.title, patchFlag: 1 /* 动态的 textContent */ } // 这是动态节点
  ]
}
```

因为 patchFlag 代表这个节点是一个动态节点，我们可以把它提取出来放在一个数组中：

```ts
const vnode = {
  type: 'div',
  children: [
    { type: 'div', children: 'static' },
    { type: 'div', children: ctx.title, patchFlag: 1 /* 动态的 textContent */ } // 这是动态节点
  ],
  dynamicChildren: [
    { type: 'div', children: ctx.title, patchFlag: 1 /* 动态的 textContent */ } // 这是动态节点
  ]
}
```

dynamicChildren 就是用来存储一个节点下所有子代动态节点的数组，用于后续的靶向更新。有了 dynamicChildren 再后续的 diff 过程中，就可以避免按照 vdom 一层层遍历，而是直接找到 dynamicChildren 进行更新，再加上我们已经提前标记好了 patchFlag，因此再更新 dynamicChildren 中的节点时，我们可以准确的知道需要为该节点应用哪些更新动作。

## 不稳定的 Block Tree

我们来看下面这段模版：

```html
<div>
	<div v-if="isShow">
    <p>{{ title }}</p>
  </div>
  <div v-else>
    <p>{{ title }}</p>
  </div>
</div>
```

当 isShow 为真时，block 收集到的动态节点：

```ts
const vnode = {
  type: 'div',
  dynamicChildren: [
    { type: 'p', children: ctx.title, patchFlag: 1 /* 动态的 textContent */ } // 这是动态节点
  ]
}
```

当 isShow 为假时，block 收集到的动态节点：

```ts
const vnode = {
  type: 'div',
  dynamicChildren: [
    { type: 'p', children: ctx.title, patchFlag: 1 /* 动态的 textContent */ } // 这是动态节点
  ]
}
```

此时我们发现无论 isShow 为真为假，block 的内容都没有发生变化，这意味这 diff 阶段不会做任何更新。

### v-if 的元素作为 Block

还是这段代码：

```html
<div>
	<div v-if="isShow">
    <p>{{ title }}</p>
  </div>
  <div v-else>
    <p>{{ title }}</p>
  </div>
</div>
```

Template Explorer

```ts
import { toDisplayString as _toDisplayString, createElementVNode as _createElementVNode, openBlock as _openBlock, createElementBlock as _createElementBlock, createCommentVNode as _createCommentVNode } from "vue"

export function render(_ctx, _cache, $props, $setup, $data, $options) {
  return (_openBlock(), _createElementBlock("div", null, [
    (_ctx.isShow)
      ? (_openBlock(), _createElementBlock("div", { key: 0 }, [
          _createElementVNode("p", null, _toDisplayString(_ctx.title), 1 /* TEXT */)
        ]))
      : (_openBlock(), _createElementBlock("div", { key: 1 }, [
          _createElementVNode("p", null, _toDisplayString(_ctx.title), 1 /* TEXT */)
        ]))
  ]))
}

// Check the console for the AST
```

我们发现他会帮我们绑定一个 props key，用来区分这两个不同的 block

此时 Block 大致是这个样子：

```ts
const vnode = {
  type: 'div',
  dynamicChildren: [
    { type: 'div', { key: 0 }, dynamicChildren: [{ type: p, children: ctx.title, patchFlag: 1 }] }, 
    { type: 'div', { key: 1 }, dynamicChildren: [{ type: p, children: ctx.title, patchFlag: 1 }] }     
  ]
}
```

当 isShow 为真时 dynamicChildren 包含有 key = 0 的 Block，当为假时 dynamicChildren 包含 key = 1 的 Block。在 diff 的过程中，渲染器就知道这是两个不同的 Block，因此会做完全替换，这也就解决了 Dom 结构不稳定引起的问题，这也就是 Block Tree。

### v-for 的元素作为 Block

v-for 也不是一个稳定的 Dom 结构。

```html
<div>
  <p v-for="item in list">{{ item }}</p>
  <p>{{ title }}</p>
</div>
```

它的 Block 看起来可能是这个样子的，以最外层的 `<ul>` 标签作为一个 Block。假设此时 list 有 3 个节点

```ts
const vnode = {
  type: 'div',
  dynamicChildren: [
    { type: 'p', children: ctx.list[0], patchFlag: 1}, 
    { type: 'p', children: ctx.list[1], patchFlag: 1},
    ...
    { type: 'p', children: ctx.title, patchFlag: 1 }
  ]
}
```
但此时如果我们改变 list 的值，增加或者移除，Block 可能就变成这样，假设此时 list 只有 1 个节点

```
const vnode = {
  type: 'ul',
  dynamicChildren: [
    { type: 'li', children: ctx.list[0], patchFlag: 1},
    { type: 'p', children: ctx.title, patchFlag: 1 }
  ]
}
```

可以看到新旧的 Block 是不一致的，oldBlock 有三个动态节点，而 newBlock 只有一个动态节点，此时做靶向更新时由于新旧 Block 结构是不一样的，就会导致无法进行 diff。

Template Explorer

```ts
import { renderList as _renderList, Fragment as _Fragment, openBlock as _openBlock, createElementBlock as _createElementBlock, toDisplayString as _toDisplayString, createElementVNode as _createElementVNode } from "vue"

export function render(_ctx, _cache, $props, $setup, $data, $options) {
  return (_openBlock(), _createElementBlock("div", null, [
    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.list, (item) => {
      return (_openBlock(), _createElementBlock("p", null, _toDisplayString(item), 1 /* TEXT */))
    }), 256 /* UNKEYED_FRAGMENT */)),
    _createElementVNode("p", null, _toDisplayString(_ctx.title), 1 /* TEXT */)
  ]))
}

// Check the console for the AST
```

通过 Template Explorer 我们发现，vue 在 complier 阶段用 Fragment 给 v-for 包裹了一层 Block，也就是把 v-for 单独作为一个 Block。

```ts
const vnode = {
  type: 'div',
  dynamicChildren: [
    { type: Fragment, dynamicChildren: [/*...v-for 的节点 */]}, 
    { type: 'p', children: ctx.title, patchFlag: 1 }
  ]
}
```

此时由于 v-for 被单独 Block 了，所以这颗 Block Tree 就是一个稳定的 Block。

### 不稳定的 Fragment

刚刚我们使用一个 Fragment 并让它充当 Block 的角色解决了 v-for 元素所在层级的结构稳定，但我们来看一下这个 Fragment 本身：

```ts
{ type: Fragment, dynamicChildren: [/*...v-for 的节点 */]}
```

对于这个模版来讲，变化前后 Block 看起来应该是这个样子：

```ts
<p v-for="item in list">{{ item }}</p>

// list: [1, 2]. 变化前 Block
const vnode = {
  type: 'Fragment',
  dynamicChildren: [
    { type: 'p', children: 1, patchFlag: 1 },
    { type: 'p', children: 2, patchFlag: 1 }
  ]
}

// list: [1]. 变化后 Block
const vnode = {
  type: 'Fragment',
  dynamicChildren: [
    { type: 'p', children: 1, patchFlag: 1 },
  ]
}
```

我们发现，Fragment 这个 Block 仍然面临结构不稳定的情况，所谓结构不稳定从结果上看指的是更新前后一个 block 的 dynamicChildren 中收集的动态节点数量或顺序的不一致。 这种不一致会导致我们没有办法直接靶向更新 diff。所以这种情况只能回归到传统 diff。

processFragment 源码：

```ts
// keyed / unkeyed, or manual fragments.
// for keyed & unkeyed, since they are compiler generated from v-for,
// each child is guaranteed to be a block so the fragment will never
// have dynamicChildren.
// 保证每个子节点都是一个block，所以fragment永远不会使用dynamicChildren
patchChildren(
  n1,
  n2,
  container,
  fragmentEndAnchor,
  parentComponent,
  parentSuspense,
  isSVG,
  slotScopeIds,
  optimized
)
```

### 稳定的 Fragment

当 v-for 遍历的为常量时，就是稳定的 Fragment

```html
<p v-for="item in 10">{{ item }}</p>
```

vue3 不再限制组件的模版必须有一个根节点，因此对于多个根节点的模版，也会用一个 Fragment 来充当他的 Block，让其 VNode 看起来仍然是只有一个根节点的模版。

```html
<div v-if="isShow"></div>
<p v-for="item in list"></p>
<p>{{ title }}</p>
<p>abc</p>
```

```ts
import { openBlock as _openBlock, createElementBlock as _createElementBlock, createCommentVNode as _createCommentVNode, renderList as _renderList, Fragment as _Fragment, toDisplayString as _toDisplayString, createElementVNode as _createElementVNode } from "vue"

export function render(_ctx, _cache, $props, $setup, $data, $options) {
  return (_openBlock(), _createElementBlock(_Fragment, null, [
    (_ctx.isShow)
      ? (_openBlock(), _createElementBlock("div", { key: 0 }))
      : _createCommentVNode("v-if", true),
    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.list, (item) => {
      return (_openBlock(), _createElementBlock("p"))
    }), 256 /* UNKEYED_FRAGMENT */)),
    _createElementVNode("p", null, _toDisplayString(_ctx.title), 1 /* TEXT */),
    _createElementVNode("p", null, "abc")
  ], 64 /* STABLE_FRAGMENT */))
}

// Check the console for the AST
```

我们从 Template Explorer 就能大致看出他的 Block Tree：

```ts
Block(Fragment)
	- Block
	- Block(Fragment)
    - Block
    ...
	- Block
	- VNode(P)
```

注意这个：PatchFlags.STABLE_FRAGMENT，该标志的存在，代表他是一个结构稳定的 Fragment。

## 静态提升

[渲染机制 | Vue.js](https://cn.vuejs.org/guide/extras/rendering-mechanism.html#static-hoisting)

```html
<div>
  <div>foo</div> <!-- 需提升 -->
  <div>bar</div> <!-- 需提升 -->
  <div>{{ dynamic }}</div>
</div>
```

```ts
import { createElementVNode as _createElementVNode, createCommentVNode as _createCommentVNode, toDisplayString as _toDisplayString, openBlock as _openBlock, createElementBlock as _createElementBlock } from "vue"

export function render(_ctx, _cache, $props, $setup, $data, $options) {
  return (_openBlock(), _createElementBlock("div", null, [
    _createElementVNode("div", null, "foo"),
    _createCommentVNode(" 需提升 "),
    _createElementVNode("div", null, "bar"),
    _createCommentVNode(" 需提升 "),
    _createElementVNode("div", null, _toDisplayString(_ctx.dynamic), 1 /* TEXT */)
  ]))
}

// Check the console for the AST
```

foo 和 bar 这两个 div 是完全静态的，没有必要在重新渲染时再次创建和比对它们。Vue 编译器自动地会提升这部分 vnode 创建函数到这个模板的渲染函数之外，并在每次渲染时都使用这份相同的 vnode，渲染器知道新旧 vnode 在这部分是完全相同的，所以会完全跳过对它们的差异比对。
此外，当有足够多连续的静态元素时，它们还会再被压缩为一个“静态 vnode”，其中包含的是这些节点相应的纯 HTML 字符串。([示例](https://template-explorer.vuejs.org/#eyJzcmMiOiI8ZGl2PlxuICA8ZGl2IGNsYXNzPVwiZm9vXCI+Zm9vPC9kaXY+XG4gIDxkaXYgY2xhc3M9XCJmb29cIj5mb288L2Rpdj5cbiAgPGRpdiBjbGFzcz1cImZvb1wiPmZvbzwvZGl2PlxuICA8ZGl2IGNsYXNzPVwiZm9vXCI+Zm9vPC9kaXY+XG4gIDxkaXYgY2xhc3M9XCJmb29cIj5mb288L2Rpdj5cbiAgPGRpdj57eyBkeW5hbWljIH19PC9kaXY+XG48L2Rpdj4iLCJzc3IiOmZhbHNlLCJvcHRpb25zIjp7ImhvaXN0U3RhdGljIjp0cnVlfX0=))。这些静态节点会直接通过 innerHTML 来挂载。同时还会在初次挂载后缓存相应的 DOM 节点。如果这部分内容在应用中其他地方被重用，那么将会使用原生的 cloneNode() 方法来克隆新的 DOM 节点，这会非常高效。

### 元素不会被提升的情况

元素带有动态的 key，此时他是不会被提升的。

```html
<div :key="foo"></div>
```

看到这里你会不会认为 key 是一个 props？其实不然，key 与 普通 props 想不，它对于 VNode 的意义是不一样的，普通的 props 如果是动态的，会被 patchFlag 标记。

```
<div :key="foo"></div>
<div :foo="foo"></div>
```

Template Explorer

```ts
import { openBlock as _openBlock, createElementBlock as _createElementBlock, createElementVNode as _createElementVNode, Fragment as _Fragment } from "vue"

export function render(_ctx, _cache, $props, $setup, $data, $options) {
  return (_openBlock(), _createElementBlock(_Fragment, null, [
    (_openBlock(), _createElementBlock("div", { key: _ctx.foo })),
    _createElementVNode("div", { foo: _ctx.foo }, null, 8 /* PROPS */, ["foo"])
  ], 64 /* STABLE_FRAGMENT */))
}

// Check the console for the AST
```

我们发现 key 并没有被标记为一个 Props。其实在 vue 中，key 本身就具有特殊意义，它是 VNode 的唯一标识，即使两个元素除了 key 以外都相同，但这两个元素仍然是不同的元素，对于不同的元素需要做到完全替换处理才行，因此 patchFlag 不会在它上面打标记。

[内置的特殊 Attributes | Vue.js](https://cn.vuejs.org/api/built-in-special-attributes.html#key)

## Cache Event handler

如下组件模板

```html
<Com @change="a + b" />
```

这段模板如果手写渲染函数的话相当于：

```ts
render(ctx) {
  return h(Com, {
    onChange: () => ctx.a + ctx.b
  })
}
```

很显然，每次 render 函数执行的时候，Comp 组件的 props 都是新的对象，onChange 也会是全新的函数。这会导致触发 Comp 组件的更新。
当 Vue3 Compiler 开启 prefixIdentifiers 以及 cacheHandlers 时，这段模板会被编译为：

```
import { resolveComponent as _resolveComponent, openBlock as _openBlock, createBlock as _createBlock } from "vue"

export function render(_ctx, _cache, $props, $setup, $data, $options) {
  const _component_Comp = _resolveComponent("Comp")

  return (_openBlock(), _createBlock(_component_Comp, {
    onChange: _cache[0] || (_cache[0] = $event => (_ctx.a + _ctx.b))
  }))
}

// Check the console for the AST
```

这样即使多次调用渲染函数也不会触发 Comp 组件的更新，因为 Vue 在 patch 阶段比对 props 时就会发现 onChange 的引用没变。
如上代码中 render 函数的 cache 对象是 Vue 内部在调用渲染函数时注入的一个数组，像下面这种：

```ts
render.call(ctx, ctx, [])
```

实际上，我们即使不依赖编译也能手写出具备 cache 能力的代码：

```ts
const Com = {
  setup() {
    return () => {
      return h(AnthorCom, {
        onChange: handleChange //  引用不变
      })
    }
  }
}
```

## 参考：

[【第1987期】Vue3 Compiler 优化细节，如何手写高性能渲染函数](https://mp.weixin.qq.com/s/u_6vq27b2NRxNOgUB3FYYQ?v_p=86&WBAPIAnalysisOriUICodes=10000011_10000011_10000198&launchid=10000365--x&wm=3333_2001&aid=01AzrSlevY37z6v38NDKadC8lPswcuCcNUXI8FE9Qmtp-qGZM.&from=10A9293010)

[内置的特殊 Attributes | Vue.js](https://cn.vuejs.org/api/built-in-special-attributes.html#key)

[渲染机制 | Vue.js](https://cn.vuejs.org/guide/extras/rendering-mechanism.html#compiler-informed-virtual-dom)

[Vue Template Explorer](https://template-explorer.vuejs.org/#eyJzcmMiOiI8ZGl2PlxyXG4gIDxkaXY+c3RhdGljPC9kaXY+XHJcbiAgPGRpdj57eyB0aXRsZSB9fTwvZGl2PlxyXG48L2Rpdj4iLCJvcHRpb25zIjp7fX0=)
