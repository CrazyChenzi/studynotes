# Vue3 的响应式核心 reactive 和 effect 实现原理以及源码分析

## reactive 和 effect

Vue3 的响应式系统通过官网的 API 可以看到有很多，例如 ref、computed、reactive、readonly、watchEffect、watch 等等，这些都是 Vue3 的响应式系统的一部分

### reactive

[reactive](https://cn.vuejs.org/api/reactivity-core.html#reactive)

reactive 根据官网的介绍，有如下特点：

- 接收一个普通对象，返回一个响应式的代理对象
- 响应式的对象是深层的，会影响对象内部所有嵌套的属性
- 会自动对ref对象进行解包
- 对于数组、对象、Map、Set等原生类型中的元素，如果是ref对象不会自动解包
- 返回的对象会通过Proxy进行包装，所以不等于原始对象

### effect

> effect在官网上是没有提到这个API的，但是在源码中是有的，并且我们也是可以直接使用，如下代码所示：

```ts
import { reactive, effect } from "vue";

const data = reactive({
  foo: 1,
  bar: 2
});

effect(() => {
  console.log(data.foo);
});

data.foo = 10;
```
 
通常情况下我们是不会直接使用effect的，因为effect是一个底层的API，在我们使用Vue3的时候Vue默认会帮我们调用effect，所以我们的关注点通常都是在reactive上。

但是reactive需要和effect配合使用才会有响应式的效果，所以我们需要了解一下effect的作用。

effect直接翻译为作用，意思是使其发生作用，这个使其的其就是我们传入的函数，所以effect的作用就是让我们传入的函数发生作用，也就是执行这个函数。

但是 effect 具体是怎么执行的呢？

## 源码

源码位置：packages/reactivity

> Built-in objects are not observed except for `Array`, `Map`, `WeakMap`, `Set` and `WeakSet`.

响应式系统出了对 `Array`、`Map`、`WeakMap`、`Set` 和 `WeakSet` 这些原生类型进行了响应式处理，对其他的原生类型，例如 `Date`、`RegExp`、`Error` 等等，都没有进行响应式处理。

### reactive

源码位置： packages/reactivity/src/reactive.ts

```ts
export function reactive(target: object) {
  // if trying to observe a readonly proxy, return the readonly version.
  // 如果对只读的代理对象进行再次代理，那么应该返回原始的只读代理对象
  if (isReadonly(target)) {
    return target
  }
  // 通过 createReactiveObject 方法创建响应式对象
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableCollectionHandlers,
    reactiveMap
  )
}
```

reactive的源码很简单，就是调用了createReactiveObject方法，这个方法是一个工厂方法，用来创建响应式对象的，我们来看看这个方法的源码。

### createReactiveObject

```ts
function createReactiveObject(
  target: Target,
  isReadonly: boolean,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>,
  proxyMap: WeakMap<Target, any>
) {
  // 如果 target 不是对象，那么直接返回 target
  if (!isObject(target)) {
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }
  // target is already a Proxy, return it.
  // exception: calling readonly() on a reactive object
  // 如果 target 已经是一个代理对象了，那么直接返回 target
  // 异常：如果对一个响应式对象调用 readonly() 方法
  if (
    target[ReactiveFlags.RAW] &&
    !(isReadonly && target[ReactiveFlags.IS_REACTIVE])
  ) {
    return target
  }
  // target already has corresponding Proxy
  // 如果 target 已经有对应的代理对象了，那么直接返回代理对象
  const existingProxy = proxyMap.get(target)
  if (existingProxy) {
    return existingProxy
  }
  // only specific value types can be observed.
  // 对于不能被观察的类型，直接返回 target
  const targetType = getTargetType(target)
  if (targetType === TargetType.INVALID) {
    return target
  }
  // 创建一个响应式对象
  const proxy = new Proxy(
    target,
    targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers
  )
  // 将 target 和 proxy 保存到 proxyMap 中
  proxyMap.set(target, proxy)
  return proxy
}
```

createReactiveObject方法的源码也很简单，最开始的一些代码都是对需要代理的target进行一些判断，判断的边界都是target不是对象的情况和target已经是一个代理对象的情况；

其中的核心的代码主要是最后七行代码：

```ts
function createReactiveObject(
  target: Target,
  isReadonly: boolean,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>,
  proxyMap: WeakMap<Target, any>
) {
  // only specific value types can be observed.
  // 对于不能被观察的类型，直接返回 target
  const targetType = getTargetType(target)
  if (targetType === TargetType.INVALID) {
    return target
  }
  // 创建一个响应式对象
  const proxy = new Proxy(
    target,
    targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers
  )
  // 将 target 和 proxy 保存到 proxyMap 中
  proxyMap.set(target, proxy)
  return proxy
}
```

这里有一个targetType的判断，那么这个targetType是什么呢？我们来看看getTargetType方法的源码：

#### getTargetType

```ts
function targetTypeMap(rawType: string) {
  switch (rawType) {
    case 'Object':
    case 'Array':
      return TargetType.COMMON
    case 'Map':
    case 'Set':
    case 'WeakMap':
    case 'WeakSet':
      return TargetType.COLLECTION
    default:
      return TargetType.INVALID
  }
}

function getTargetType(value: Target) {
  return value[ReactiveFlags.SKIP] || !Object.isExtensible(value)
    ? TargetType.INVALID
    : targetTypeMap(toRawType(value))
}
```

```ts
const enum TargetType {
  INVALID = 0, // 无效的数据类型，对应的值是 0，表示 Vue 不会对这种类型的数据进行响应式处理
  COMMON = 1, // 普通的数据类型，对应的值是 1，表示 Vue 会对这种类型的数据进行响应式处理
  COLLECTION = 2 // 集合类型，对应的值是 2，表示 Vue 会对这种类型的数据进行响应式处理
}

export const enum ReactiveFlags {
  SKIP = '__v_skip', // 用于标识一个对象是否不可被转为代理对象，对应的值是 __v_skip
  IS_REACTIVE = '__v_isReactive', // 用于标识一个对象是否是响应式的代理，对应的值是 __v_isReactive
  IS_READONLY = '__v_isReadonly', // 用于标识一个对象是否是只读的代理，对应的值是 __v_isReadonly
  IS_SHALLOW = '__v_isShallow', // 用于标识一个对象是否是浅层代理，对应的值是 __v_isShallow
  RAW = '__v_raw' // 用于保存原始对象的 key，对应的值是 __v_raw
}
```

### collectionHandlers & baseHandlers

```ts
// 创建一个响应式对象
const proxy = new Proxy(
  target,
  targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers
)
```

targetType 根据枚举值也就只有3个值，最后走向代理的也就只有两种情况：

- targetType为1的时候，这个时候target是一个普通的对象或者数组，这个时候使用baseHandlers
- targetType为2的时候，这个时候target是一个集合类型，这个时候使用collectionHandlers

而这两个 handler 是通过外部传入的，也就是 createReactiveObject 的第三第四个参数。

```ts
export function reactive(target: object) {
  // if trying to observe a readonly proxy, return the readonly version.
  // 如果对只读的代理对象进行再次代理，那么应该返回原始的只读代理对象
  if (isReadonly(target)) {
    return target
  }
  // 通过 createReactiveObject 方法创建响应式对象
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableCollectionHandlers,
    reactiveMap
  )
}
```

#### baseHandler

源码位置： packages/reactivity/src/baseHandlers.ts

```ts
export const mutableHandlers: ProxyHandler<object> = {
  get,
  set,
  deleteProperty,
  has,
  ownKeys
}
```

这里分别定义了 get、set、deleteProperty、has、ownKeys 这几个方法拦截器

- get：拦截对象的getter操作，比如obj.name；
- set：拦截对象的setter操作，比如obj.name = 'zhangsan'；
- deleteProperty：拦截delete操作，比如delete obj.name；
- has：拦截in操作，比如'name' in obj；
- ownKeys：拦截Object.getOwnPropertyNames、Object.getOwnPropertySymbols、Object.keys等操作；

[详细](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy)

接下来我们看一下这些拦截器的具体实现

##### get

```ts
function createGetter(isReadonly = false, shallow = false) {
  return function get(target: Target, key: string | symbol, receiver: object) {
    if (key === ReactiveFlags.IS_REACTIVE) {
      // 代理 observer.__v_isReactive
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      // 代理 observer.__v_isReadonly
      return isReadonly
    } else if (key === ReactiveFlags.IS_SHALLOW) {
      // 代理 observer.__v_isShallow
      return shallow
    } else if (
      // 代理 observer.__v_raw
      key === ReactiveFlags.RAW &&
      receiver ===
        (isReadonly
          ? shallow
            ? shallowReadonlyMap
            : readonlyMap
          : shallow
          ? shallowReactiveMap
          : reactiveMap
        ).get(target)
    ) {
      return target
    }

    const targetIsArray = isArray(target)

    if (!isReadonly) {
      // arrayInstrumentations 包含对数组一些方法修改的函数
      if (targetIsArray && hasOwn(arrayInstrumentations, key)) {
        return Reflect.get(arrayInstrumentations, key, receiver)
      }
      if (key === 'hasOwnProperty') {
        return hasOwnProperty
      }
    }
    // 求值
    const res = Reflect.get(target, key, receiver)
    // 内置 Sysbol key 不需要依赖收集
    if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
      return res
    }

    if (!isReadonly) {
      // 依赖收集
      track(target, TrackOpTypes.GET, key)
    }

    if (shallow) {
      return res
    }

    if (isRef(res)) {
      // ref unwrapping - skip unwrap for Array + integer key.
      return targetIsArray && isIntegerKey(key) ? res : res.value
    }

    if (isObject(res)) {
      // Convert returned value into a proxy as well. we do the isObject check
      // here to avoid invalid value warning. Also need to lazy access readonly
      // and reactive here to avoid circular dependency.
      // 如果返回的值是对象,那么将其转为代理对象
      return isReadonly ? readonly(res) : reactive(res)
    }

    return res
  }
}
```

从上述代码来看， get 函数主要做了四件事情，**首先对特殊 key 做了代理**，就比如我们在 createReactiveObject 函数中判断响应式对象是否存在 __v_raw 属性，如果存在就返回这个响应式对象本身。

**接着通过 Reflect.get 方法求值**，如果 target 是数组并且 key 命中的 arrayInstrumentations, 则执行对应的函数。

**arrayInstrumentations 实现**

```ts
function createArrayInstrumentations() {
  const instrumentations: Record<string, Function> = {}
  // instrument identity-sensitive Array methods to account for possible reactive
  // values
  ;(['includes', 'indexOf', 'lastIndexOf'] as const).forEach(key => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      // toRaw 可以把响应式对象转成原始数据
      const arr = toRaw(this) as any
      for (let i = 0, l = this.length; i < l; i++) {
        // 依赖收集
        track(arr, TrackOpTypes.GET, i + '')
      }
      // we run the method using the original args first (which may be reactive)
      // 先尝试用参数本身，可能是响应式数据
      const res = arr[key](...args)
      if (res === -1 || res === false) {
        // if that didn't work, run it again using raw values.
        // 如果失败，再尝试把参数转成原始数据
        return arr[key](...args.map(toRaw))
      } else {
        return res
      }
    }
  })
  // instrument length-altering mutation methods to avoid length being tracked
  // which leads to infinite loops in some cases (#2137)
  ;(['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      pauseTracking()
      const res = (toRaw(this) as any)[key].apply(this, args)
      resetTracking()
      return res
    }
  })
  return instrumentations
}
```

也就是说，当 target 为一个数组的时候，我们去访问 target.includes、target.indexOf 或者 target.lastIndexOf 就会执行 arrayInstrumentations 的代理函数。整个 get 函数最核心的部分就是 **执行 track 函数收集依赖**


##### set

源码位置：packages/reactivity/src/baseHandlers.ts

```ts
function createSetter(shallow = false) {
  return function set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    // 获取旧值
    let oldValue = (target as any)[key]
    // 如果旧值是只读的，并且是 ref，并且新值不是 ref，那么直接返回 false，代表设置失败
    if (isReadonly(oldValue) && isRef(oldValue) && !isRef(value)) {
      return false
    }
    if (!shallow) {
      if (!isShallow(value) && !isReadonly(value)) {
        oldValue = toRaw(oldValue) // 获取旧值的原始值
        value = toRaw(value) // 获取新值的原始值
      }
      // 如果目标对象不是数组，并且旧值是 ref，并且新值不是 ref，那么设置旧值的 value 为新值，并且返回 true，代表设置成功
      // ref 的值是在 value 属性上的，这里判断了旧值的代理类型，所以设置到了旧值的 value 上
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
        oldValue.value = value
        return true
      }
    } else {
      // in shallow mode, objects are set as-is regardless of reactive or not
    }
    // 如果是数组，并且 key 是整数类型
    const hadKey =
      isArray(target) && isIntegerKey(key)
        // 如果 key 小于数组的长度，那么就是有这个 key
        ? Number(key) < target.length
        // 如果不是数组，那么就是普通对象，直接判断是否有这个 key
        : hasOwn(target, key)
    // 通过 Reflect.set 设置值
    const result = Reflect.set(target, key, value, receiver)
    // don't trigger if target is something up in the prototype chain of original
    // 如果目标对象是原始数据的原型链中的某个元素，则不会触发依赖收集
    if (target === toRaw(receiver)) {
      // 如果没有这个 key，那么就是新增了一个属性，触发 add 事件
      if (!hadKey) {
        trigger(target, TriggerOpTypes.ADD, key, value)
      } else if (hasChanged(value, oldValue)) {
        // 如果有这个 key，那么就是修改了一个属性，触发 set 事件
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
      }
    }
    // 返回结果，这个结果为 boolean 类型，代表是否设置成功
    // 只是代理相关，，和业务无关，必须要返回是否设置成功的结果
    return result
  }
}
```

set 函数主要做了两件事情，通过 Reflect.set 求值，通过 trigger 函数派发通知，并根据 key 是否存在于 target 上来确定通知类型，即新增还是修改。整个 set 函数最核心的就是 **trigger 函数派发通知**。


#### effect 函数

上面讲完了reactive方法，接下来就是effect方法，effect方法的作用是创建一个副作用函数，这个函数会在依赖的数据发生变化的时候执行；

依赖收集和触发更新的过程先不要着急，等讲完effect方法之后，再来分析这个过程，先看看effect方法的实现：

```ts
export function effect<T = any>(
  fn: () => T,
  options?: ReactiveEffectOptions
): ReactiveEffectRunner {
  // 如果 fn 对象上有 effect 属性
  if ((fn as ReactiveEffectRunner).effect) {
    // 那么就将 fn 替换为 fn.effect.fn
    fn = (fn as ReactiveEffectRunner).effect.fn
  }
  // 创建一个响应式副作用函数
  const _effect = new ReactiveEffect(fn)
  // 如果有配置项
  if (options) {
    // 将配置项合并到响应式副作用函数上
    extend(_effect, options)
    // 如果配置项中有 scope 属性（该属性的作用是指定副作用函数的作用域）
    // 那么就将 scope 属性记录到响应式副作用函数上（类似一个作用域链）
    if (options.scope) recordEffectScope(_effect, options.scope)
  }
  // 如果没有配置项，或者配置项中没有 lazy 属性，或者配置项中的 lazy 属性为 false
  if (!options || !options.lazy) {
    _effect.run() // 那么就执行响应式副作用函数
  }
  // 将 _effect.run 的 this 指向 _effect
  const runner = _effect.run.bind(_effect) as ReactiveEffectRunner
  // 将响应式副作用函数赋值给 runner.effect
  runner.effect = _effect
  return runner
}
```

这里的关键点有两个部分

- 创建一个响应式副作用函数const _effect = new ReactiveEffect(fn)
- 返回一个runner函数，可以通过这个函数来执行响应式副作用函数

#### ReactiveEffect

```ts
constructor(
  public fn: () => T, // 副作用函数
  public scheduler: EffectScheduler | null = null, // 调度器，用于控制副作用函数何时执行
  scope?: EffectScope
) {
  recordEffectScope(this, scope) // 记录当前 ReactiveEffect 对象的作用域
}
```

ReactiveEffect这个类的实现主要体现在两个方法上，一个是run方法，一个是stop方法；

其他的属性都是用来记录一些数据的，比如fn属性就是用来记录副作用函数的，scheduler属性就是用来记录调度器的，active属性就是用来记录当前ReactiveEffect对象是否处于活动状态的；

**run**

```ts
run() {
  // 如果当前 ReactiveEffect 对象不处于活动状态，直接返回 fn 的执行结果
  if (!this.active) {
    return this.fn()
  }
  // 寻找当前 ReactiveEffect 对象的最顶层的父级作用域
  let parent: ReactiveEffect | undefined = activeEffect
  let lastShouldTrack = shouldTrack
  while (parent) {
    if (parent === this) {
      return
    }
    parent = parent.parent
  }
  try {
    // 记录父级作用域为当前活动的 ReactiveEffect 对象
    this.parent = activeEffect
    // 将当前活动的 ReactiveEffect 对象设置为 “自己”
    activeEffect = this
    // 将 shouldTrack 设置为 true （表示是否需要收集依赖）
    shouldTrack = true
    // effectTrackDepth 用于标识当前的 effect 调用栈的深度，执行一次 effect 就会将 effectTrackDepth 加 1
    trackOpBit = 1 << ++effectTrackDepth
    // 这里是用于控制 "effect调用栈的深度" 在一个阈值之内
    if (effectTrackDepth <= maxMarkerBits) {
      // 初始依赖追踪标记
      initDepMarkers(this)
    } else {
      // 清除所有的依赖追踪标记
      cleanupEffect(this)
    }
    // 执行副作用函数，并返回执行结果
    return this.fn()
  } finally {
    // 如果 effect调用栈的深度 没有超过阈值
    if (effectTrackDepth <= maxMarkerBits) {
      // 确定最终的依赖追踪标记
      finalizeDepMarkers(this)
    }
    // 执行完毕会将 effectTrackDepth 减 1
    trackOpBit = 1 << --effectTrackDepth
    // 执行完毕，将当前活动的 ReactiveEffect 对象设置为 “父级作用域”
    activeEffect = this.parent
    // 将 shouldTrack 设置为上一个值
    shouldTrack = lastShouldTrack
    // 将父级作用域设置为 undefined
    this.parent = undefined
    // 延时停止，这个标志是在 stop 方法中设置的
    if (this.deferStop) {
      this.stop()
    }
  }
}
```

整体梳理下来，run方法的作用就是执行副作用函数，并且在执行副作用函数的过程中，会收集依赖

整体的流程还是非常复杂的，但是这里的核心思想是各种标识位的设置，以及在执行副作用函数的过程中，会收集依赖

**stop**

```ts
stop() {
  // stopped while running itself - defer the cleanup
  // 如果当前 活动的 ReactiveEffect 对象是 “自己”
  // 延迟停止，需要执行完当前的副作用函数之后再停止
  if (activeEffect === this) {
    // 在 run 方法中会判断 deferStop 的值，如果为 true，就会执行 stop 方法
    this.deferStop = true
  } else if (this.active) { // 如果当前 ReactiveEffect 对象处于活动状态
    cleanupEffect(this) // 清除所有的依赖追踪标记
    // 如果有 onStop 回调函数，就执行
    if (this.onStop) {
      this.onStop()
    }
    // 将 active 设置为 false
    this.active = false
  }
}
```

stop方法的作用就是停止当前的ReactiveEffect对象，停止之后，就不会再收集依赖了

这里的activeEffect和this并不是每次都相等的，因为activeEffect会跟着调用栈的深度而变化，而this则是固定的

this.active标识的自身是否处在活动状态，因为嵌套的ReactiveEffect对象，activeEffect并不一定指向自己，而this.active则是自身的状态

#### 依赖收集

##### track 函数

源码位置：packages/reactivity/src/effect.ts

```ts
export function track(target: object, type: TrackOpTypes, key: unknown) {
  // 如果 shouldTrack 为 false，并且 activeEffect 没有值的话，就不会收集依赖
  if (shouldTrack && activeEffect) {
    // 如果 targetMap 中没有 target，就会创建一个 Map
    let depsMap = targetMap.get(target)
    if (!depsMap) {
      targetMap.set(target, (depsMap = new Map()))
    }
    // 如果 depsMap 中没有 key，就会创建一个 Set
    let dep = depsMap.get(key)
    if (!dep) {
      depsMap.set(key, (dep = createDep()))
    }

    const eventInfo = __DEV__
      ? { effect: activeEffect, target, type, key }
      : undefined

    // 如果 dep 中没有当前的 ReactiveEffect 对象，就会添加进去
    trackEffects(dep, eventInfo)
  }
}
```

在这里我们发现了两个老熟人，一个是shouldTrack，一个是activeEffect，这两个变量都是在effect方法中出现过的；

shouldTrack在上面也讲过，它的作用就是控制是否收集依赖

activeEffect就是我们刚刚讲的ReactiveEffect对象，它指向的就是当前正在执行的副作用函数；

track方法的作用就是收集依赖，它的实现非常简单，就是在targetMap中记录下target和key；

targetMap是一个WeakMap，它的键是target，值是一个Map，这个Map的键是key，值是一个Set；

这意味着，如果我们在操作target的key时，就会收集依赖，这个时候，target和key就会被记录到targetMap中

##### trigger函数的实现

```ts
export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  // 通过 targetMap 获取 target 对应的 depsMap
  const depsMap = targetMap.get(target)
  if (!depsMap) {
    // never been tracked
    // 没有依赖，直接返回
    return
  }
  // 创建一个数组，用来存放需要执行的 ReactiveEffect 对象
  let deps: (Dep | undefined)[] = []
   // 如果 type 为 clear，就会将 depsMap 中的所有 ReactiveEffect 对象都添加到 deps 中
  if (type === TriggerOpTypes.CLEAR) {
    // collection being cleared
    // trigger all effects for target
    // 执行所有的 副作用函数
    deps = [...depsMap.values()]
  } else if (key === 'length' && isArray(target)) { // 如果 key 为 length ，并且 target 是一个数组
    // 修改数组的长度，会导致数组的索引发生变化
    // 但是只有两种情况，一种是数组的长度变大，一种是数组的长度变小
    // 如果数组的长度变大，那么执行所有的副作用函数就可以了
    // 如果数组的长度变小，那么就需要执行索引大于等于新数组长度的副作用函数
    const newLength = Number(newValue)
    depsMap.forEach((dep, key) => {
      if (key === 'length' || key >= newLength) {
        deps.push(dep)
      }
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    // key 不是 undefined，就会将 depsMap 中 key 对应的 ReactiveEffect 对象添加到 deps 中
    // void 0 就是 undefined
    if (key !== void 0) {
      deps.push(depsMap.get(key))
    }

    // also run for iteration key on ADD | DELETE | Map.SET
    // 执行 add、delete、set 操作时，就会触发的依赖变更
    switch (type) {
      // 如果 type 为 add，就会触发的依赖变更
      case TriggerOpTypes.ADD:
        // 如果 target 不是数组，就会触发迭代器
        if (!isArray(target)) {
          // ITERATE_KEY 再上面介绍过，用来标识迭代属性
          // 例如：for...in、for...of，这个时候依赖会收集到 ITERATE_KEY 上
          // 而不是收集到具体的 key 上
          deps.push(depsMap.get(ITERATE_KEY))
          // 如果 target 是一个 Map，就会触发 MAP_KEY_ITERATE_KEY
          if (isMap(target)) {
            // MAP_KEY_ITERATE_KEY 同上面的 ITERATE_KEY 一样
            // 不同的是，它是用来标识 Map 的迭代器
            // 例如：Map.prototype.keys()、Map.prototype.values()、Map.prototype.entries()
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        } else if (isIntegerKey(key)) { // 如果 key 是一个数字，就会触发 length 依赖
          // new index added to array -> length changes
          // 因为数组的索引是可以通过 arr[0] 这种方式来访问的
          // 也可以通过这种方式来修改数组的值，所以会触发 length 依赖
          deps.push(depsMap.get('length'))
        }
        break
      // 如果 type 为 delete，就会触发的依赖变更
      case TriggerOpTypes.DELETE:
        // 如果 target 不是数组，就会触发迭代器，同上面的 add 操作
        if (!isArray(target)) {
          deps.push(depsMap.get(ITERATE_KEY))
          if (isMap(target)) {
            deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        }
        break
      // 如果 type 为 set，就会触发的依赖变更
      case TriggerOpTypes.SET:
        // 如果 target 是一个 Map，就会触发迭代器，同上面的 add 操作
        if (isMap(target)) {
          deps.push(depsMap.get(ITERATE_KEY))
        }
        break
    }
  }

  const eventInfo = __DEV__
    ? { target, type, key, newValue, oldValue, oldTarget }
    : undefined
  // 如果 deps 的长度为 1，就会直接执行
  if (deps.length === 1) {
    if (deps[0]) {
      if (__DEV__) {
        triggerEffects(deps[0], eventInfo)
      } else {
        triggerEffects(deps[0])
      }
    }
  } else {
    // 如果 deps 的长度大于 1，这个时候会组装成一个数组，然后再执行
    // 这个时候调用就类似一个调用栈
    const effects: ReactiveEffect[] = []
    for (const dep of deps) {
      if (dep) {
        effects.push(...dep)
      }
    }
    if (__DEV__) {
      triggerEffects(createDep(effects), eventInfo)
    } else {
      triggerEffects(createDep(effects))
    }
  }
}
```

tigger函数的作用就是触发依赖，当我们修改数据的时候，就会触发依赖，然后执行依赖中的副作用函数。

在这里的实现其实并没有执行，主要是收集一些需要执行的副作用函数，然后在丢给triggerEffects函数去执行。

**triggerEffects**

```ts
export function triggerEffects(
  dep: Dep | ReactiveEffect[],
  debuggerEventExtraInfo?: DebuggerEventExtraInfo
) {
  // spread into array for stabilization
  // 如果 dep 不是数组，就会将 dep 转换成数组，因为这里的 dep 可能是一个 Set 对象
  const effects = isArray(dep) ? dep : [...dep]
  for (const effect of effects) {
    if (effect.computed) {
      triggerEffect(effect, debuggerEventExtraInfo)
    }
  }
  // 执行 computed 依赖
  for (const effect of effects) {
    if (!effect.computed) {
      triggerEffect(effect, debuggerEventExtraInfo)
    }
  }
}
```

这里没什么特殊的，就是转换一下dep，然后执行computed依赖和其他依赖，主要还是在triggerEffect函数：

**triggerEffect**

```ts
function triggerEffect(
  effect: ReactiveEffect,
  debuggerEventExtraInfo?: DebuggerEventExtraInfo
) {
  // 如果 effect 不是 activeEffect，或者 effect 允许递归，就会执行
  if (effect !== activeEffect || effect.allowRecurse) {
    if (__DEV__ && effect.onTrigger) {
      effect.onTrigger(extend({ effect }, debuggerEventExtraInfo))
    }
    // 如果 effect 是一个调度器，就会执行 scheduler
    if (effect.scheduler) {
      effect.scheduler()
    } else {
      effect.run()
    }
  }
}
```


这里的 effect.scheduler和effect.run，在我们看effect函数的时候，就已经出现过了，run就是调用副作用函数，scheduler是调度器，允许用户自定义调用副作用函数的时机。

### 总结

整个响应式系统的实现，主要是围绕的effect函数，reactive函数，track函数，trigger函数这四个函数。

每个函数都只做自己的事情，各司其职：

- effect函数：创建一个副作用函数，主要的作用是来运行副作用函数
- reactive函数：创建一个响应式对象，主要的作用是来监听对象的变化
- track函数：依赖收集，主要收集的就是effect函数
- trigger函数：依赖触发，主要的作用是来触发track函数收集的effect函数

get中调用track函数收集activeEffect，这个时候activeEffect是一定存在的，并且activeEffect中的副作用函数是一定引用了这个响应式对象的，所以这个时候就可以将这个响应式对象和activeEffect关联起来。

将当前的对象作为key，将activeEffect作为value，存储到targetMap中，这样就完成了依赖收集。

在响应式对象的set钩子中，调用trigger函数，将targetMap中的activeEffect取出来，然后执行activeEffect的run函数，这样就完成了依赖触发。

#### 参考

[https://segmentfault.com/a/1190000043507445#item-2-5](https://segmentfault.com/a/1190000043507445#item-2-5)
