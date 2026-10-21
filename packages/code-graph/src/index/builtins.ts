/**
 * Names every file can use without writing or importing them: the language's
 * globals and builtins. They are never a frontier, and a member access through
 * one (`Math.max`, `console.log`) is never resolved by name. Each list is
 * explicit; a name missing here can surface as a false frontier, never hide one.
 */
import type { LanguageId } from "../parse/languages.ts";

const words = (text: string) => new Set(text.split(/\s+/).filter(Boolean));

/**
 * TypeScript: the global values of lib.es2023 (with the later ECMAScript globals
 * runtimes already ship), the common DOM and web-platform globals and
 * constructors (not every DOM interface), the Node globals, and the lib's
 * global types a class may extend or implement (`ReadonlyMap`, `Iterable`).
 */
const SCRIPT = words(`
  globalThis Infinity NaN undefined eval isFinite isNaN parseFloat parseInt
  decodeURI decodeURIComponent encodeURI encodeURIComponent escape unescape
  Object Function Boolean Symbol Number BigInt Math Date String RegExp Array JSON
  Promise Proxy Reflect Intl Atomics Iterator
  Error AggregateError EvalError RangeError ReferenceError SyntaxError TypeError URIError
  Map Set WeakMap WeakSet WeakRef FinalizationRegistry
  ArrayBuffer SharedArrayBuffer DataView Int8Array Uint8Array Uint8ClampedArray
  Int16Array Uint16Array Int32Array Uint32Array Float16Array Float32Array Float64Array
  BigInt64Array BigUint64Array

  window self document navigator location history screen frames parent top opener
  localStorage sessionStorage indexedDB caches crypto performance console
  customElements visualViewport
  alert confirm prompt print open close focus blur stop postMessage reportError
  structuredClone queueMicrotask setTimeout clearTimeout setInterval clearInterval
  requestAnimationFrame cancelAnimationFrame requestIdleCallback cancelIdleCallback
  fetch atob btoa getComputedStyle matchMedia getSelection scroll scrollBy scrollTo
  addEventListener removeEventListener dispatchEvent createImageBitmap
  URL URLSearchParams Blob File FileList FileReader FormData Headers Request Response
  TextEncoder TextDecoder TextEncoderStream TextDecoderStream AbortController AbortSignal
  ReadableStream WritableStream TransformStream CompressionStream DecompressionStream
  Event EventTarget CustomEvent ErrorEvent MessageEvent ProgressEvent CloseEvent
  PromiseRejectionEvent UIEvent FocusEvent InputEvent KeyboardEvent MouseEvent
  PointerEvent WheelEvent TouchEvent DragEvent ClipboardEvent AnimationEvent
  TransitionEvent SubmitEvent
  MessageChannel MessagePort BroadcastChannel Worker SharedWorker ServiceWorker
  WebSocket EventSource XMLHttpRequest Notification
  Image ImageData ImageBitmap Audio OffscreenCanvas Path2D CanvasRenderingContext2D
  WebGLRenderingContext WebGL2RenderingContext FontFace
  DOMParser XMLSerializer DOMRect DOMPoint DOMMatrix DOMException
  Node Element HTMLElement SVGElement Document DocumentFragment ShadowRoot Text Comment
  Range Selection NodeFilter TreeWalker CSSStyleSheet CSS
  HTMLCanvasElement HTMLDivElement HTMLInputElement HTMLImageElement HTMLVideoElement
  HTMLAudioElement HTMLAnchorElement HTMLButtonElement HTMLFormElement
  ResizeObserver MutationObserver IntersectionObserver PerformanceObserver

  process Buffer require module exports global __dirname __filename
  setImmediate clearImmediate

  ReadonlyArray ReadonlyMap ReadonlySet ArrayLike PromiseLike Iterable Iterator
  IterableIterator AsyncIterable AsyncIterableIterator Generator AsyncGenerator
  PropertyKey Record Partial Required Readonly Pick Omit Exclude Extract NonNullable
  ReturnType Parameters ConstructorParameters InstanceType Awaited ThisType
  Uppercase Lowercase Capitalize Uncapitalize
`);

/** Python: `sorted(dir(builtins))` from CPython 3.14. */
const PYTHON = words(`
  ArithmeticError AssertionError AttributeError BaseException BaseExceptionGroup
  BlockingIOError BrokenPipeError BufferError BytesWarning ChildProcessError
  ConnectionAbortedError ConnectionError ConnectionRefusedError ConnectionResetError
  DeprecationWarning EOFError Ellipsis EncodingWarning EnvironmentError Exception
  ExceptionGroup False FileExistsError FileNotFoundError FloatingPointError FutureWarning
  GeneratorExit IOError ImportError ImportWarning IndentationError IndexError
  InterruptedError IsADirectoryError KeyError KeyboardInterrupt LookupError MemoryError
  ModuleNotFoundError NameError None NotADirectoryError NotImplemented NotImplementedError
  OSError OverflowError PendingDeprecationWarning PermissionError ProcessLookupError
  PythonFinalizationError RecursionError ReferenceError ResourceWarning RuntimeError
  RuntimeWarning StopAsyncIteration StopIteration SyntaxError SyntaxWarning SystemError
  SystemExit TabError TimeoutError True TypeError UnboundLocalError UnicodeDecodeError
  UnicodeEncodeError UnicodeError UnicodeTranslateError UnicodeWarning UserWarning
  ValueError Warning ZeroDivisionError _IncompleteInputError __build_class__ __debug__
  __doc__ __import__ __loader__ __name__ __package__ __spec__ abs aiter all anext any
  ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex
  copyright credits delattr dict dir divmod enumerate eval exec exit filter float format
  frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter
  len license list locals map max memoryview min next object oct open ord pow print
  property quit range repr reversed round set setattr slice sorted staticmethod str sum
  super tuple type vars zip
`);

/** Go: the universe block of the language specification. */
const GO = words(`
  any bool byte comparable complex64 complex128 error float32 float64 int int8 int16
  int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr
  true false iota nil
  append cap clear close complex copy delete imag len make max min new panic print
  println real recover
`);

/**
 * Rust: the primitive types, the standard prelude (rust_2021 and rust_2024),
 * and the macros exported by `std`.
 */
const RUST = words(`
  bool char str i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 Self

  Copy Send Sized Sync Unpin Drop Fn FnMut FnOnce AsyncFn AsyncFnMut AsyncFnOnce drop
  size_of size_of_val align_of align_of_val Box ToOwned Clone PartialEq PartialOrd Eq
  Ord AsRef AsMut Into From TryFrom TryInto Default Iterator Extend IntoIterator
  DoubleEndedIterator ExactSizeIterator FromIterator Option Some None Result Ok Err
  String ToString Vec Future IntoFuture

  assert assert_eq assert_ne cfg column compile_error concat dbg debug_assert
  debug_assert_eq debug_assert_ne env eprint eprintln file format format_args include
  include_bytes include_str is_x86_feature_detected line matches module_path option_env
  panic print println stringify thread_local todo unimplemented unreachable vec write
  writeln
`);

const BY_LANGUAGE: Readonly<Record<LanguageId, ReadonlySet<string>>> = {
  typescript: SCRIPT,
  tsx: SCRIPT,
  python: PYTHON,
  go: GO,
  rust: RUST,
};

export const isBuiltin = (language: LanguageId, name: string) => BY_LANGUAGE[language].has(name);
