(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (global){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('isarray')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Safari 5-7 lacks support for changing the `Object.prototype.constructor` property
 *     on objects.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = global.TYPED_ARRAY_SUPPORT !== undefined
  ? global.TYPED_ARRAY_SUPPORT
  : typedArraySupport()

function typedArraySupport () {
  function Bar () {}
  try {
    var arr = new Uint8Array(1)
    arr.foo = function () { return 42 }
    arr.constructor = Bar
    return arr.foo() === 42 && // typed array instances can be augmented
        arr.constructor === Bar && // constructor can be set
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        arr.subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
}

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (arg) {
  if (!(this instanceof Buffer)) {
    // Avoid going through an ArgumentsAdaptorTrampoline in the common case.
    if (arguments.length > 1) return new Buffer(arg, arguments[1])
    return new Buffer(arg)
  }

  this.length = 0
  this.parent = undefined

  // Common case.
  if (typeof arg === 'number') {
    return fromNumber(this, arg)
  }

  // Slightly less common case.
  if (typeof arg === 'string') {
    return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8')
  }

  // Unusual.
  return fromObject(this, arg)
}

function fromNumber (that, length) {
  that = allocate(that, length < 0 ? 0 : checked(length) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < length; i++) {
      that[i] = 0
    }
  }
  return that
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') encoding = 'utf8'

  // Assumption: byteLength() return value is always < kMaxLength.
  var length = byteLength(string, encoding) | 0
  that = allocate(that, length)

  that.write(string, encoding)
  return that
}

function fromObject (that, object) {
  if (Buffer.isBuffer(object)) return fromBuffer(that, object)

  if (isArray(object)) return fromArray(that, object)

  if (object == null) {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (typeof ArrayBuffer !== 'undefined') {
    if (object.buffer instanceof ArrayBuffer) {
      return fromTypedArray(that, object)
    }
    if (object instanceof ArrayBuffer) {
      return fromArrayBuffer(that, object)
    }
  }

  if (object.length) return fromArrayLike(that, object)

  return fromJsonObject(that, object)
}

function fromBuffer (that, buffer) {
  var length = checked(buffer.length) | 0
  that = allocate(that, length)
  buffer.copy(that, 0, 0, length)
  return that
}

function fromArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Duplicate of fromArray() to keep fromArray() monomorphic.
function fromTypedArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  // Truncating the elements is probably not what people expect from typed
  // arrays with BYTES_PER_ELEMENT > 1 but it's compatible with the behavior
  // of the old Buffer constructor.
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayBuffer (that, array) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    array.byteLength
    that = Buffer._augment(new Uint8Array(array))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromTypedArray(that, new Uint8Array(array))
  }
  return that
}

function fromArrayLike (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Deserialize { type: 'Buffer', data: [1,2,3,...] } into a Buffer object.
// Returns a zero-length buffer for inputs that don't conform to the spec.
function fromJsonObject (that, object) {
  var array
  var length = 0

  if (object.type === 'Buffer' && isArray(object.data)) {
    array = object.data
    length = checked(array.length) | 0
  }
  that = allocate(that, length)

  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

if (Buffer.TYPED_ARRAY_SUPPORT) {
  Buffer.prototype.__proto__ = Uint8Array.prototype
  Buffer.__proto__ = Uint8Array
}

function allocate (that, length) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = Buffer._augment(new Uint8Array(length))
    that.__proto__ = Buffer.prototype
  } else {
    // Fallback: Return an object instance of the Buffer class
    that.length = length
    that._isBuffer = true
  }

  var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1
  if (fromPool) that.parent = rootParent

  return that
}

function checked (length) {
  // Note: cannot use `length < kMaxLength` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  var i = 0
  var len = Math.min(x, y)
  while (i < len) {
    if (a[i] !== b[i]) break

    ++i
  }

  if (i !== len) {
    x = a[i]
    y = b[i]
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; i++) {
      length += list[i].length
    }
  }

  var buf = new Buffer(length)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

function byteLength (string, encoding) {
  if (typeof string !== 'string') string = '' + string

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'binary':
      // Deprecated
      case 'raw':
      case 'raws':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

function slowToString (encoding, start, end) {
  var loweredCase = false

  start = start | 0
  end = end === undefined || end === Infinity ? this.length : end | 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toString = function toString () {
  var length = this.length | 0
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` is deprecated
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` is deprecated
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    var swap = encoding
    encoding = offset
    offset = length | 0
    length = swap
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'binary':
        return binaryWrite(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
      : (firstByte > 0xBF) ? 2
      : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = (value & 0xff)
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; i--) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; i++) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), targetStart)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array set method before overwriting
  arr._set = arr.set

  // deprecated
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"base64-js":2,"ieee754":3,"isarray":4}],2:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],3:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],4:[function(require,module,exports){
var toString = {}.toString;

module.exports = Array.isArray || function (arr) {
  return toString.call(arr) == '[object Array]';
};

},{}],5:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('./common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('./common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonLang = require('./common/lang');

var _commonLang2 = _interopRequireDefault(_commonLang);

var _commonUtils = require('./common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _domUtilsDomExtend = require('./domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

var _amendAmend = require('./amend/amend');

var _amendAmend2 = _interopRequireDefault(_amendAmend);

var _commonHistoryUtils = require('./common/historyUtils');

var _commonHistoryUtils2 = _interopRequireDefault(_commonHistoryUtils);

var _commonBase64 = require('./common/Base64');

var _commonBase642 = _interopRequireDefault(_commonBase64);

var _rangeUtilsRangeExtend = require('./rangeUtils/rangeExtend');

var _rangeUtilsRangeExtend2 = _interopRequireDefault(_rangeUtilsRangeExtend);

var _tableUtilsTableCore = require('./tableUtils/tableCore');

var _tableUtilsTableCore2 = _interopRequireDefault(_tableUtilsTableCore);

var _todoUtilsTodoCore = require('./todoUtils/todoCore');

var _todoUtilsTodoCore2 = _interopRequireDefault(_todoUtilsTodoCore);

var _linkUtilsLinkUtils = require('./linkUtils/linkUtils');

var _linkUtilsLinkUtils2 = _interopRequireDefault(_linkUtilsLinkUtils);

var _imgUtilsImgUtils = require('./imgUtils/imgUtils');

var _imgUtilsImgUtils2 = _interopRequireDefault(_imgUtilsImgUtils);

var _nightModeNightModeUtils = require('./nightMode/nightModeUtils');

var _nightModeNightModeUtils2 = _interopRequireDefault(_nightModeNightModeUtils);

var _editorBase = require('./editor/base');

var _editorBase2 = _interopRequireDefault(_editorBase);

var _editorEditorEvent = require('./editor/editorEvent');

var _editorEditorEvent2 = _interopRequireDefault(_editorEditorEvent);

var WizEditor = {
    version: '1.0',
    /**
     * 初始化 修订编辑
     * @param options
     * {
     *   document, //document
     *   lang,      //语言 JSON
     *   userInfo,  //用户数据 JSON
     *   userData,  //kb内所有用户数据集合 Array[JSON]
     *   maxRedo,   //redo 最大堆栈数（默认100）
     *   callback {
     *      redo,  //history callback
     *   },
     *   clientType,  //客户端类型
     * }
     */
    init: function init(options) {
        _commonEnv2['default'].init('editor', options);
        _commonEnv2['default'].dependency.files.init();

        _editorBase2['default'].init();
        _amendAmend2['default'].initUser();
        _amendAmend2['default'].setUsersData();

        if (_commonEnv2['default'].win.WizTemplate) {
            _commonEnv2['default'].win.WizTemplate.init({
                document: _commonEnv2['default'].doc,
                lang: _commonEnv2['default'].options.lang,
                clientType: _commonEnv2['default'].options.clientType
            });
        }
        return WizEditor;
    },
    /**
     * 启动编辑器
     */
    on: function on() {
        if (_commonEnv2['default'].win.WizReader) {
            _commonEnv2['default'].win.WizReader.off();
        }

        _editorBase2['default'].on();

        if (_commonEnv2['default'].win.WizTemplate) {
            _commonEnv2['default'].win.WizTemplate.on(false).focus();
        }

        return WizEditor;
    },
    /**
     * 关闭编辑器
     */
    off: function off(options) {
        if (_commonEnv2['default'].win.WizTemplate) {
            _commonEnv2['default'].win.WizTemplate.off();
        }
        _editorBase2['default'].off();

        if (_commonEnv2['default'].win.WizReader) {
            _commonEnv2['default'].win.WizReader.on(options);
        }

        return WizEditor;
    },
    /**
     * 备份光标位置
     */
    backupCaret: function backupCaret() {
        return _rangeUtilsRangeExtend2['default'].backupCaret();
    },
    /**
     * 清除 临时 & 冗余的 wiz 标签（主要用于保存笔记前）
     */
    clearWizDom: function clearWizDom() {
        _domUtilsDomExtend2['default'].clearChild(_commonEnv2['default'].doc.body, []);
        _amendAmend2['default'].hideAmendInfo();

        return WizEditor;
    },
    /**
     * 让 body 获取焦点
     */
    focus: function focus() {
        _domUtilsDomExtend2['default'].focus();

        return WizEditor;
    },
    /**
     * 获取 body 内正文，用于生成摘要
     * @returns {*}
     */
    getBodyText: function getBodyText() {
        return _domUtilsDomExtend2['default'].getBodyText();
    },
    /**
     * 获取当前页面源码
     * @returns {*}
     */
    getContentHtml: function getContentHtml() {
        _todoUtilsTodoCore2['default'].checkTodoStyle();
        return _domUtilsDomExtend2['default'].getContentHtml();
    },
    insertDefaultStyle: function insertDefaultStyle(onlyReplace, customCss) {
        _editorBase2['default'].insertDefaultStyle(onlyReplace, customCss);

        return WizEditor;
    },
    /**
     * 在光标位置插入 base64 格式的html
     * @param b64Html
     */
    insertB64Html: function insertB64Html(b64Html) {
        _editorBase2['default'].insertHtml(_commonBase642['default'].decode(b64Html));
    },
    /**
     * 在光标位置插入 html
     * @param html
     */
    insertHtml: function insertHtml(html) {
        _editorBase2['default'].insertHtml(html);
    },
    /**
     * 判断编辑内容是否被修改
     * @returns {boolean}
     */
    isModified: function isModified() {
        return !_commonEnv2['default'].readonly && _domUtilsDomExtend2['default'].getContentHtml() != _editorBase2['default'].getOriginalHtml();
    },
    /**
     * 设置当前文档为 未修改状态
     */
    setUnModified: function setUnModified() {
        _editorBase2['default'].setOriginalHtml();
    },
    /**
     * 修改光标选中文本的样式 和 属性
     * @param style (example:{'font-size':'16px', 'color':'red'})
     * @param attr
     */
    modifySelectionDom: function modifySelectionDom(style, attr) {
        _editorBase2['default'].modifySelectionDom(style, attr);
    },
    /**
     * 编辑器 redo
     */
    redo: function redo() {
        _commonHistoryUtils2['default'].redo();

        return WizEditor;
    },
    /**
     * 恢复已备份光标位置
     */
    restoreCaret: function restoreCaret() {
        return _rangeUtilsRangeExtend2['default'].restoreCaret();
    },
    /**
     * 编辑器 保存快照
     */
    saveSnap: function saveSnap() {
        _commonHistoryUtils2['default'].saveSnap(false);

        return WizEditor;
    },
    /**
     * 编辑器 undo
     */
    undo: function undo() {
        _commonHistoryUtils2['default'].undo();

        return WizEditor;
    },
    ListenerType: _editorEditorEvent2['default'].TYPE,
    addListener: function addListener(eName, fun) {
        _editorEditorEvent2['default'].addListener(eName, fun);
        return WizEditor;
    },
    removeListener: function removeListener(eName, fun) {
        _editorEditorEvent2['default'].removeListener(eName, fun);
        return WizEditor;
    },
    triggerListener: function triggerListener(eName, params) {
        _editorEditorEvent2['default'].triggerListener(eName, params);
        return WizEditor;
    },
    startTrackEvent: function startTrackEvent(eventName, id) {
        _editorEditorEvent2['default'].startTrackEvent(eventName, id);
    },
    stopTrackEvent: function stopTrackEvent(eventName, id) {
        _editorEditorEvent2['default'].stopTrackEvent(eventName, id);
    },
    amend: {
        /**
         * 开启 修订功能
         * @param status  // true：开启修订； false：关闭修订
         */
        on: function on() {
            _amendAmend2['default'].start();

            return WizEditor;
        },
        /**
         * 关闭 修订功能
         */
        off: function off() {
            //关闭 修订功能 需要同时开启 逆修订功能
            _amendAmend2['default'].startReverse();

            return WizEditor;
        },
        /**
         * 获取 笔记是否被进行过 修订编辑
         * @returns {boolean}
         */
        isEdited: function isEdited() {
            return _amendAmend2['default'].isAmendEdited();
        },
        /**
         * 获取 笔记当前 修订状态
         * @returns {boolean}
         */
        isEditing: function isEditing() {
            return _amendAmend2['default'].isAmendEditing();
        },
        /**
         * 判断当前光标位置是否处于修订标签内
         * @returns {boolean}
         */
        hasAmendSpanByCursor: function hasAmendSpanByCursor() {
            return _amendAmend2['default'].hasAmendSpanByCursor();
        },
        /**
         * 接受 修订内容， 清理所有修订的标签
         * @params options
         */
        accept: function accept(options) {
            _amendAmend2['default'].accept(initAmendAcceptOptions(options));
        },
        /**
         * 拒绝 修订内容， 恢复原内容
         * @param options
         */
        refuse: function refuse(options) {
            _amendAmend2['default'].refuse(initAmendAcceptOptions(options));
        }
    },
    img: {
        getAll: function getAll(onlyLocal) {
            //为了保证客户端使用方便，转换为字符串
            return _imgUtilsImgUtils2['default'].getAll(onlyLocal).join(',');
        },
        insertAsAttachment: function insertAsAttachment(guid, imgPath) {
            var imgHtml = _imgUtilsImgUtils2['default'].makeAttachmentHtml(guid, imgPath);
            _editorBase2['default'].insertHtml(imgHtml);
        },
        insertByPath: function insertByPath(imgPath) {
            _editorBase2['default'].insertDom(_imgUtilsImgUtils2['default'].makeDomByPath(imgPath));
        }
    },
    link: {
        /**
         * 开启 自动设置 超链接功能
         */
        on: function on() {
            _linkUtilsLinkUtils2['default'].on();
        },
        /**
         * 关闭 自动设置 超链接功能
         */
        off: function off() {
            _linkUtilsLinkUtils2['default'].off();
        },
        /**
         * 移除选中的 <a> 标签的超链接
         */
        removeSelectedLink: function removeSelectedLink() {
            _linkUtilsLinkUtils2['default'].removeSelectedLink();
        }
    },
    table: {
        canCreateTable: _tableUtilsTableCore2['default'].canCreateTable,
        clearCellValue: _tableUtilsTableCore2['default'].clearCellValue,
        deleteCols: _tableUtilsTableCore2['default'].deleteCols,
        deleteRows: _tableUtilsTableCore2['default'].deleteRows,
        deleteTable: _tableUtilsTableCore2['default'].deleteTable,
        distributeCols: _tableUtilsTableCore2['default'].distributeCols,
        insertCol: _tableUtilsTableCore2['default'].insertCol,
        insertRow: _tableUtilsTableCore2['default'].insertRow,
        insertTable: _tableUtilsTableCore2['default'].insertTable,
        merge: _tableUtilsTableCore2['default'].merge,
        setCellAlign: _tableUtilsTableCore2['default'].setCellAlign,
        setCellBg: _tableUtilsTableCore2['default'].setCellBg,
        split: _tableUtilsTableCore2['default'].split
    },
    todo: {
        setTodo: _todoUtilsTodoCore2['default'].setTodo,
        setTodoInfo: _todoUtilsTodoCore2['default'].setTodoInfo
    },
    nightMode: {
        on: function on(color, bgColor, brightness) {
            _nightModeNightModeUtils2['default'].on(color, bgColor, brightness);
        },
        off: function off() {
            _nightModeNightModeUtils2['default'].off();
        }
    }
};

function initAmendAcceptOptions(options) {
    if (!options) {
        options = {
            dom: null,
            cursor: false,
            total: true
        };
    }
    options.total = !!options.total;
    options.dom = options.dom;
    options.cursor = !!options.cursor;
    return options;
}

window.WizEditor = WizEditor;

exports['default'] = WizEditor;
module.exports = exports['default'];

},{"./amend/amend":7,"./common/Base64":12,"./common/const":13,"./common/env":15,"./common/historyUtils":16,"./common/lang":17,"./common/utils":19,"./domUtils/domExtend":24,"./editor/base":25,"./editor/editorEvent":26,"./imgUtils/imgUtils":29,"./linkUtils/linkUtils":30,"./nightMode/nightModeUtils":34,"./rangeUtils/rangeExtend":36,"./tableUtils/tableCore":39,"./todoUtils/todoCore":43}],6:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('./common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('./common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonLang = require('./common/lang');

var _commonLang2 = _interopRequireDefault(_commonLang);

var _commonUtils = require('./common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _domUtilsDomExtend = require('./domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

var _imgUtilsImgUtils = require('./imgUtils/imgUtils');

var _imgUtilsImgUtils2 = _interopRequireDefault(_imgUtilsImgUtils);

var _nightModeNightModeUtils = require('./nightMode/nightModeUtils');

var _nightModeNightModeUtils2 = _interopRequireDefault(_nightModeNightModeUtils);

var _amendAmendInfo = require('./amend/amendInfo');

var _amendAmendInfo2 = _interopRequireDefault(_amendAmendInfo);

var _amendAmendUser = require('./amend/amendUser');

var _amendAmendUser2 = _interopRequireDefault(_amendAmendUser);

var _todoUtilsTodoCore = require('./todoUtils/todoCore');

var _todoUtilsTodoCore2 = _interopRequireDefault(_todoUtilsTodoCore);

var _readerBase = require('./reader/base');

var _readerBase2 = _interopRequireDefault(_readerBase);

var _markdownMarkdownRender = require('./markdown/markdownRender');

var _markdownMarkdownRender2 = _interopRequireDefault(_markdownMarkdownRender);

var WizReader = {
    /**
     * 初始化 修订编辑
     * @param options
     * {
     *   document, //document
     *   lang,      //语言 JSON
     *   userInfo,  //用户数据 JSON
     *   userData,  //kb内所有用户数据集合 Array[JSON]
     *   clientType,  //客户端类型,
     *   noAmend, //Boolean 是否显示 修订信息
     *   noteType // 'common' 'markdown' 'mathjax' 笔记类型
     * }
     */
    init: function init(options) {
        _commonEnv2['default'].init('reader', options);
        _commonEnv2['default'].dependency.files.init();

        _readerBase2['default'].init();
        _markdownMarkdownRender2['default'].init();

        if (!_commonEnv2['default'].options.noAmend) {
            _amendAmendUser2['default'].initUser(_commonEnv2['default'].options.userInfo);
            _amendAmendUser2['default'].setUsersData(_commonEnv2['default'].options.usersData);
        }

        if (_commonEnv2['default'].win.WizTemplate) {
            _commonEnv2['default'].win.WizTemplate.init({
                document: _commonEnv2['default'].doc,
                lang: _commonEnv2['default'].options.lang,
                clientType: _commonEnv2['default'].options.clientType
            });
        }

        return WizReader;
    },
    /**
     *
     * @param options
     * {
     *   noteType 笔记类型
     * }
     */
    on: function on(options) {
        if (options && options.noteType) {
            _commonEnv2['default'].options.noteType = options.noteType;
        }
        _readerBase2['default'].on();

        WizReader.amendInfo.on();
        if (_commonEnv2['default'].win.WizTemplate) {
            _commonEnv2['default'].win.WizTemplate.on(true);
        }

        if (_commonEnv2['default'].options.noteType == _commonConst2['default'].NOTE_TYPE.MARKDOWN) {
            WizReader.markdown();
        } else if (_commonEnv2['default'].options.noteType == _commonConst2['default'].NOTE_TYPE.MATHJAX) {
            WizReader.mathJax();
        }

        return WizReader;
    },
    off: function off() {
        WizReader.amendInfo.off();

        if (_commonEnv2['default'].win.WizTemplate) {
            _commonEnv2['default'].win.WizTemplate.off();
        }

        _readerBase2['default'].off();

        return WizReader;
    },
    insertDefaultStyle: function insertDefaultStyle(onlyReplace, customCss) {
        _readerBase2['default'].insertDefaultStyle(onlyReplace, customCss);

        return WizReader;
    },
    markdown: function markdown(callback, timeout) {
        timeout = timeout ? timeout : _commonEnv2['default'].options.timeout.markdown;
        callback = callback || _commonEnv2['default'].options.callback.markdown;
        var hasCalled = false,
            cb = function cb() {
            if (callback && /^function$/i.test(typeof callback) && !hasCalled) {
                callback();
                hasCalled = true;
            }
        };
        _markdownMarkdownRender2['default'].markdown({
            markdown: function markdown(isMathjax) {
                //IOS 处理 todolist 应该可以删除了
                _commonEnv2['default'].client.sendCmdToWiznote(_commonConst2['default'].CLIENT_EVENT.wizMarkdownRender);
                if (!isMathjax) {
                    cb();
                } else {
                    setTimeout(cb, timeout);
                }
            },
            mathJax: function mathJax() {
                cb();
            }
        });
    },
    mathJax: function mathJax(callback, timeout) {
        timeout = timeout ? timeout : _commonEnv2['default'].options.timeout.mathJax;
        callback = callback || _commonEnv2['default'].options.callback.mathJax;
        var hasCalled = false,
            cb = function cb() {
            if (callback && !hasCalled) {
                callback();
                hasCalled = true;
            }
        };

        setTimeout(cb, timeout);
        _markdownMarkdownRender2['default'].mathJax(function () {
            cb();
        });
    },
    amendInfo: {
        on: function on() {
            if (_commonEnv2['default'].options.noAmend) {
                return WizReader;
            }
            _amendAmendInfo2['default'].init({
                readonly: true
            }, {
                onAccept: null,
                onRefuse: null
            });

            return WizReader;
        },
        off: function off() {
            _amendAmendInfo2['default'].remove();

            return WizReader;
        }
    },
    img: {
        getAll: function getAll(onlyLocal) {
            //为了保证客户端使用方便，转换为字符串
            return _imgUtilsImgUtils2['default'].getAll(onlyLocal).join(',');
        }
    },
    todo: {
        setTodoInfo: _todoUtilsTodoCore2['default'].setTodoInfo,
        closeDocument: _todoUtilsTodoCore2['default'].closeDocument,
        onCheckDocLock: _todoUtilsTodoCore2['default'].onCheckDocLock
    },
    nightMode: {
        on: function on(color, bgColor, brightness) {
            _nightModeNightModeUtils2['default'].on(color, bgColor, brightness);
        },
        off: function off() {
            _nightModeNightModeUtils2['default'].off();
        }
    }
};

window.WizReader = WizReader;

exports['default'] = WizReader;
module.exports = exports['default'];

},{"./amend/amendInfo":8,"./amend/amendUser":9,"./common/const":13,"./common/env":15,"./common/lang":17,"./common/utils":19,"./domUtils/domExtend":24,"./imgUtils/imgUtils":29,"./markdown/markdownRender":33,"./nightMode/nightModeUtils":34,"./reader/base":37,"./todoUtils/todoCore":43}],7:[function(require,module,exports){
/**
 * 修订功能 专用工具包
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonLang = require('../common/lang');

var _commonLang2 = _interopRequireDefault(_commonLang);

var _commonUtils = require('../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _domUtilsDomExtend = require('../domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

var _amendUtilsAmendExtend = require('./amendUtils/amendExtend');

var _amendUtilsAmendExtend2 = _interopRequireDefault(_amendUtilsAmendExtend);

var _amendUser = require('./amendUser');

var _amendUser2 = _interopRequireDefault(_amendUser);

var _amendInfo = require('./amendInfo');

var _amendInfo2 = _interopRequireDefault(_amendInfo);

var _commonHistoryUtils = require('../common/historyUtils');

var _commonHistoryUtils2 = _interopRequireDefault(_commonHistoryUtils);

var _rangeUtilsRangeExtend = require('../rangeUtils/rangeExtend');

var _rangeUtilsRangeExtend2 = _interopRequireDefault(_rangeUtilsRangeExtend);

var _tableUtilsTableUtils = require('../tableUtils/tableUtils');

var _tableUtilsTableUtils2 = _interopRequireDefault(_tableUtilsTableUtils);

var _tableUtilsTableZone = require('../tableUtils/tableZone');

var _tableUtilsTableZone2 = _interopRequireDefault(_tableUtilsTableZone);

var _todoUtilsTodoCore = require('../todoUtils/todoCore');

var _todoUtilsTodoCore2 = _interopRequireDefault(_todoUtilsTodoCore);

//为 domUtils 打补丁
(function () {
    var modifyNodeStyle = _domUtilsDomExtend2['default'].modifyNodeStyle;
    //针对 修订特殊处理 image
    _domUtilsDomExtend2['default'].modifyNodeStyle = function (item, style, attr) {
        var p;
        if (item.nodeType == 1 && attr && attr[_commonConst2['default'].ATTR.SPAN_DELETE] && _domUtilsDomExtend2['default'].isTag(item, 'img')) {
            _amendUtilsAmendExtend2['default'].deleteImg(item, _amendUser2['default'].getCurUser());
            return item;
        } else if (item.nodeType == 1 && attr && attr[_commonConst2['default'].ATTR.SPAN_DELETE] && _domUtilsDomExtend2['default'].isEmptyDom(item)) {
            //TODO 需要提取 判断br 的方法
            // 只能删除 被父节点内单独存在的 br
            p = item.parentNode;
            p.removeChild(item);
            _domUtilsDomExtend2['default'].removeEmptyParent(p);
            return item;
        } else if (item.nodeType == 1 && attr && attr[_commonConst2['default'].ATTR.SPAN_DELETE] && _domUtilsDomExtend2['default'].isSelfClosingTag(item)) {
            return item;
        } else if (attr && attr[_commonConst2['default'].ATTR.SPAN_DELETE] && _amendUtilsAmendExtend2['default'].getWizDeleteParent(item)) {
            return item;
        } else {
            return modifyNodeStyle(item, style, attr);
        }
    };
    var addDomForGetDomList = _domUtilsDomExtend2['default'].addDomForGetDomList;
    //忽略 在修订模式下 已经删除的内容
    _domUtilsDomExtend2['default'].addDomForGetDomList = function (main, sub) {
        //忽略 在修订模式下 已经删除的内容
        if (_amendUtilsAmendExtend2['default'].isWizDelete(sub) ||
        //td tr 之间不能添加 span!!
        sub.nodeType == 3 && !_domUtilsDomExtend2['default'].getParentByTagName(sub, ['td', 'th'], false, null) && _domUtilsDomExtend2['default'].getParentByTagName(sub, 'table', false, null)) {
            return;
        }
        addDomForGetDomList(main, sub);
    };
})();

var _isAmendEditing = false;
var amend = {
    initUser: function initUser() {
        _amendUser2['default'].initUser(_commonEnv2['default'].options.userInfo);
    },
    setUsersData: function setUsersData() {
        _amendUser2['default'].setUsersData(_commonEnv2['default'].options.usersData);
    },
    /**
     * 开启 修订功能
     */
    start: function start() {
        _isAmendEditing = true;
        amend.stopReverse();
        amendEvent.bind();
        amend.startAmendInfo();
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.BEFORE_SAVESNAP, amendEvent.onBeforeSaveSnap);
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.AFTER_RESTORE_HISTORY, amendEvent.onAfterRestoreHistory);
    },
    /**
     * 关闭 修订功能
     */
    stop: function stop() {
        _isAmendEditing = false;
        amendEvent.unbind();
        _amendInfo2['default'].remove();
        if (!amend.isAmendEdited()) {
            //删除 所有修订者 信息
            //amendUser.removeAllUserInfo();
        }
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.BEFORE_SAVESNAP, amendEvent.onBeforeSaveSnap);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.AFTER_RESTORE_HISTORY, amendEvent.onAfterRestoreHistory);
    },
    /**
     * 开启 反转修订功能
     */
    startReverse: function startReverse() {
        amend.stop();

        amendEvent.bindReverse();
        amend.startAmendInfo();
    },
    /**
     * 关闭 反转修订功能
     */
    stopReverse: function stopReverse() {
        amendEvent.unbindReverse();
        _amendInfo2['default'].remove();
        if (!amend.isAmendEdited()) {
            //删除 所有修订者 信息
            //amendUser.removeAllUserInfo();
        }
    },
    /**
     * 开启显示 修订信息
     */
    startAmendInfo: function startAmendInfo(options) {
        _amendInfo2['default'].init(options, {
            onAccept: amendEvent.onAccept,
            onRefuse: amendEvent.onRefuse
        });
    },
    /**
     * 关闭显示 修订信息
     */
    stopAmendInfo: function stopAmendInfo() {
        _amendInfo2['default'].remove();
    },
    /**
     * 隐藏显示 修订信息（主要用于保存笔记前处理）
     */
    hideAmendInfo: function hideAmendInfo() {
        _amendInfo2['default'].hide(true);
    },
    /**
     * 判断笔记是否存在 被修订的痕迹
     * @returns boolean
     */
    isAmendEdited: function isAmendEdited() {
        return _amendUtilsAmendExtend2['default'].isAmendEdited();
    },
    isAmendEditing: function isAmendEditing() {
        return _isAmendEditing;
    },
    hasAmendSpanByCursor: function hasAmendSpanByCursor() {
        var amendDoms = _amendUtilsAmendExtend2['default'].getAmendDoms({
            selection: true,
            selectAll: false
        });

        return amendDoms.insertList.length > 0 || amendDoms.deleteList.length > 0 || amendDoms.deletedInsertList.length > 0;
    },
    /**
     * 接受 修订内容
     * @param target
     */
    accept: function accept(target) {
        var sel = _commonEnv2['default'].doc.getSelection(),
            options = {},
            amendDoms;

        if (target.total) {
            options.selection = true;
            options.selectAll = true;
        } else if (target.dom && !target.isSelection) {
            options.domList = _amendUtilsAmendExtend2['default'].getSameTimeStampDom(target.dom);
            options.selection = false;
        } else {
            //TODO 无光标焦点时，跳转到下一个修订内容
            if (sel.rangeCount === 0) {
                return;
            }

            options.selection = true;
            options.selectAll = false;
        }

        //先保存 内容快照，便于 undo
        _commonHistoryUtils2['default'].saveSnap(false);

        if (options.selection && !options.selectAll) {
            amendDoms = _amendUtilsAmendExtend2['default'].getSelectedAmendDoms();
        } else {
            amendDoms = _amendUtilsAmendExtend2['default'].getAmendDoms(options);
        }

        if (amendDoms) {
            _amendUtilsAmendExtend2['default'].splitSelectedAmendDoms(amendDoms);

            //删除 已删除的
            _amendUtilsAmendExtend2['default'].wizAmendDelete(amendDoms.deleteList);
            _amendUtilsAmendExtend2['default'].wizAmendDelete(amendDoms.deletedInsertList);
            //保留 新添加的
            _amendUtilsAmendExtend2['default'].wizAmendSave(amendDoms.insertList);
        }

        //合并文档， 清除冗余html
        _domUtilsDomExtend2['default'].clearChild(_commonEnv2['default'].doc.body, []);
    },
    /**
     *  拒绝 修订内容
     *  @param target
     */
    refuse: function refuse(target) {
        var sel = _commonEnv2['default'].doc.getSelection(),
            options = {},
            amendDoms;

        if (target.total) {
            options.selection = true;
            options.selectAll = true;
        } else if (target.dom && !target.isSelection) {
            options.domList = _amendUtilsAmendExtend2['default'].getSameTimeStampDom(target.dom);
            options.selection = false;
        } else {
            //TODO 无光标焦点时，跳转到下一个修订内容
            if (sel.rangeCount === 0) {
                return;
            }

            options.selection = true;
            options.selectAll = false;
        }

        //先保存 内容快照，便于 undo
        _commonHistoryUtils2['default'].saveSnap(false);

        if (options.selection && !options.selectAll) {
            amendDoms = _amendUtilsAmendExtend2['default'].getSelectedAmendDoms();
        } else {
            amendDoms = _amendUtilsAmendExtend2['default'].getAmendDoms(options);
        }

        if (amendDoms) {
            _amendUtilsAmendExtend2['default'].splitSelectedAmendDoms(amendDoms);

            //对于 用户B 删除了用户A 新增的内容，只有单独选中该 dom 拒绝修订时， 才还原为 用户A 新增的内容，
            //否则拒绝时，一律当作 用户A 新增的内容进行删除操作
            var saveDeletedInsert = amendDoms.deletedInsertList.length > 0 && amendDoms.deleteList.length == 0 && amendDoms.insertList.length == 0;

            //保留 已删除的
            _amendUtilsAmendExtend2['default'].wizAmendSave(amendDoms.deleteList);
            if (saveDeletedInsert) {
                _amendUtilsAmendExtend2['default'].wizAmendSave(amendDoms.deletedInsertList);
            }
            //删除 新添加的
            _amendUtilsAmendExtend2['default'].wizAmendDelete(amendDoms.insertList);
            if (!saveDeletedInsert) {
                _amendUtilsAmendExtend2['default'].wizAmendDelete(amendDoms.deletedInsertList);
            }
        }

        //合并文档， 清除冗余html
        _domUtilsDomExtend2['default'].clearChild(_commonEnv2['default'].doc.body, []);
    },
    /**
     * 参考 amendUtils.splitAmendDomByRange
     * @param fixed
     */
    splitAmendDomByRange: function splitAmendDomByRange(fixed) {
        return _amendUtilsAmendExtend2['default'].splitAmendDomByRange(fixed);
    },
    /**
     * 为 复制/剪切 操作，准备 fragment
     */
    getFragmentForCopy: function getFragmentForCopy(isCut) {
        var range = _rangeUtilsRangeExtend2['default'].getRange(),
            tmpParent,
            fragment = null;
        //无光标时， 不操作任何内容
        if (!range || range.collapsed) {
            return fragment;
        }

        tmpParent = _domUtilsDomExtend2['default'].getParentRoot([range.startContainer, range.endContainer]);
        //只有在修订状态时才禁止复制 已删除 的内容
        if (amend.isAmendEditing() && tmpParent && tmpParent.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE) == _amendUser2['default'].getCurUser().hash) {
            alert(isCut ? _commonLang2['default'].Err.Cut_Null : _commonLang2['default'].Err.Copy_Null);
        } else {
            fragment = _commonEnv2['default'].doc.createElement('div');
            fragment.appendChild(range.cloneContents());
        }
        return fragment;
    },
    /**
     * 复制时 根据 fragment 过滤修订内容
     * @param fragment
     */
    fragmentFilter: function fragmentFilter(fragment) {
        var delDom, i, delDomItem;

        if (!fragment) {
            return false;
        }

        delDom = fragment.querySelectorAll('span[' + _commonConst2['default'].ATTR.SPAN_DELETE + '="' + _amendUser2['default'].getCurUser().hash + '"]');
        for (i = delDom.length - 1; i >= 0; i--) {
            delDomItem = delDom[i];
            delDomItem.parentNode.removeChild(delDomItem);
        }
    },
    readyForPaste: function readyForPaste() {
        var sel = _commonEnv2['default'].doc.getSelection(),
            range,
            endDomBak,
            endDom,
            endOffset,
            id,
            newDom,
            nSpanStart,
            nSpanContent,
            nSpanEnd,
            nSpanNext,
            nA,
            p,
            tmpSplit,
            splitInsert,
            amendImg,
            isTd;

        //无光标时， 不操作任何内容
        if (sel.rangeCount === 0) {
            return;
        }

        if (!sel.isCollapsed) {
            range = sel.getRangeAt(0);
            endDomBak = _domUtilsDomExtend2['default'].getParentByTagName(range.endContainer, ['td', 'th'], true, null);
            _amendUtilsAmendExtend2['default'].removeSelection(_amendUser2['default'].getCurUser());
            _amendUtilsAmendExtend2['default'].removeUserDel(null, _amendUser2['default'].getCurUser());
        }

        range = sel.getRangeAt(0);
        endDom = range.endContainer;
        endOffset = range.endOffset;

        if (_domUtilsDomExtend2['default'].isTag(endDom, ['td', 'th']) && endOffset === 0 && endDomBak !== endDom) {
            //清理 用户已删除内容时，可能会导致 光标进入到下一个 td 内，所以必须修正
            endDom = endDomBak;
            endOffset = _domUtilsDomExtend2['default'].getDomEndOffset(endDom);
        }

        splitInsert = _amendUtilsAmendExtend2['default'].splitInsertDom(endDom, endOffset, true, _amendUser2['default'].getCurUser());

        id = new Date().valueOf();
        newDom = _amendUtilsAmendExtend2['default'].createDomForPaste(id);
        nSpanStart = newDom.start;
        nSpanContent = newDom.content;
        nSpanEnd = newDom.end;
        amendImg = _amendUtilsAmendExtend2['default'].getWizAmendImgParent(endDom);

        if (splitInsert.split) {
            //如果在 用户新增的 span 内操作， 则在span 拆分后，添加到 两个 span 之间
            if (endDom.nodeType == 3) {
                endDom = endDom.parentNode;
            }
            _domUtilsDomExtend2['default'].before(endDom, [nSpanStart, nSpanContent, nSpanEnd], endOffset > 0);
        } else if (amendImg) {
            _domUtilsDomExtend2['default'].before(amendImg, [nSpanStart, nSpanContent, nSpanEnd], true);
        } else if (endDom.nodeType == 1) {
            // endDom nodeType == 1 时， 光标应该是在 childNodes[endOffset] 元素的前面
            isTd = false;
            if (_domUtilsDomExtend2['default'].isTag(endDom, ['td', 'th'])) {
                //如果 target 是 td 则必须在 td内建立 span，避免插入到 td 后面
                if (_domUtilsDomExtend2['default'].isEmptyDom(endDom)) {
                    endDom.innerHTML = '';
                    endDom.appendChild(_domUtilsDomExtend2['default'].createSpan());
                }
                isTd = true;
            }

            if (endOffset < endDom.childNodes.length) {
                _domUtilsDomExtend2['default'].before(endDom.childNodes[endOffset], [nSpanStart, nSpanContent, nSpanEnd], false);
            } else if (isTd) {
                endDom.appendChild(nSpanStart);
                endDom.appendChild(nSpanContent);
                endDom.appendChild(nSpanEnd);
            } else {
                _domUtilsDomExtend2['default'].before(endDom, [nSpanStart, nSpanContent, nSpanEnd], true);
            }
        } else if (endDom.nodeType == 3) {
            if (_amendUtilsAmendExtend2['default'].splitDeletedDom(endDom, endOffset)) {
                _domUtilsDomExtend2['default'].before(endDom.parentNode, [nSpanStart, nSpanContent, nSpanEnd], true);
            } else if (endOffset < endDom.nodeValue.length) {
                tmpSplit = _commonEnv2['default'].doc.createTextNode(endDom.nodeValue.substr(endOffset));
                endDom.nodeValue = endDom.nodeValue.substr(0, endOffset);
                _domUtilsDomExtend2['default'].before(endDom, [nSpanStart, nSpanContent, nSpanEnd, tmpSplit], true);
            } else {
                nA = _domUtilsDomExtend2['default'].getParentByTagName(endDom, 'a', true, null);
                nSpanNext = endDom.nextSibling;
                if (nA) {
                    //光标在 <A> 标签结尾的时候，一定要让光标进入 <A> 下一个Dom
                    _domUtilsDomExtend2['default'].before(nA, [nSpanStart, nSpanContent, nSpanEnd], true);
                } else if (nSpanNext) {
                    _domUtilsDomExtend2['default'].before(nSpanNext, [nSpanStart, nSpanContent, nSpanEnd], false);
                } else {
                    p = endDom.parentNode;
                    p.insertBefore(nSpanStart, null);
                    p.insertBefore(nSpanContent, null);
                    p.insertBefore(nSpanEnd, null);
                }
            }
        }

        //不能使用 selectAllChildren ，否则 输入 空格时 浏览器会自动复制前一个 span 的所有样式
        //        sel.selectAllChildren(nSpanStart);
        _rangeUtilsRangeExtend2['default'].setRange(nSpanContent.childNodes[0], 0, nSpanContent.childNodes[0], 1);

        setTimeout(function () {
            //有时候 nSpanEnd 的 DOM 在 粘贴操作后会自动变成新的 DOM 导致处理异常，
            //所以必须重新获取 nSpanEnd
            nSpanEnd = _commonEnv2['default'].doc.querySelector('span[' + _commonConst2['default'].ATTR.SPAN_PASTE_TYPE + '="' + _commonConst2['default'].TYPE.PASTE.END + '"][' + _commonConst2['default'].ATTR.SPAN_PASTE_ID + '="' + nSpanEnd.getAttribute(_commonConst2['default'].ATTR.SPAN_PASTE_ID) + '"]');
            amend.fixPaste(nSpanStart, nSpanEnd, _amendUser2['default'].getCurUser());
        }, 200);
    },
    fixPaste: function fixPaste(start, end, user) {
        _amendUtilsAmendExtend2['default'].modifyDomForPaste(start, end, user);
    }
};

/**
 * 修订操作的 事件处理
 */
var amendEvent = {
    /**
     * 初始化时，绑定修订相关的必要事件
     */
    bind: function bind() {
        amendEvent.unbind();
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_KEY_DOWN, amendEvent.onKeyDown);
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_COMPOSITION_START, amendEvent.onCompositionStart);
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_COMPOSITION_END, amendEvent.onCompositionEnd);

        if (!(_commonEnv2['default'].client.type.isIOS || _commonEnv2['default'].client.type.isAndroid)) {
            _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_MOUSE_DOWN, amendEvent.onMouseDown);
            _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_MOUSE_UP, amendEvent.onMouseUp);
        } else {
            _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_TOUCH_START, amendEvent.onTouchStart);
        }
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_DRAG_START, amendEvent.onDragDrop);
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_DRAG_ENTER, amendEvent.onDragDrop);
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_DROP, amendEvent.onDragDrop);
    },
    /**
     * 解绑修订相关的必要事件
     */
    unbind: function unbind() {
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_KEY_DOWN, amendEvent.onKeyDown);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_COMPOSITION_START, amendEvent.onCompositionStart);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_COMPOSITION_END, amendEvent.onCompositionEnd);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_MOUSE_DOWN, amendEvent.onMouseDown);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_MOUSE_UP, amendEvent.onMouseUp);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_TOUCH_START, amendEvent.onTouchStart);

        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_DRAG_START, amendEvent.onDragDrop);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_DRAG_ENTER, amendEvent.onDragDrop);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_DROP, amendEvent.onDragDrop);
    },
    /**
     * 绑定反转修订相关的必要事件
     */
    bindReverse: function bindReverse() {
        amendEvent.unbindReverse();
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_KEY_DOWN, amendEvent.onKeyDownReverse);
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_COMPOSITION_START, amendEvent.onCompositionStart);
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_COMPOSITION_END, amendEvent.onCompositionEnd);
        if (!_commonEnv2['default'].client.type.isIOS && _commonEnv2['default'].client.type.isAndroid) {
            _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_MOUSE_DOWN, amendEvent.onMouseDown);
            _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_MOUSE_UP, amendEvent.onMouseUp);
        }
    },
    /**
     * 解绑反转修订相关的必要事件
     */
    unbindReverse: function unbindReverse() {
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_KEY_DOWN, amendEvent.onKeyDownReverse);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_COMPOSITION_START, amendEvent.onCompositionStart);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_COMPOSITION_END, amendEvent.onCompositionEnd);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_MOUSE_DOWN, amendEvent.onMouseDown);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_MOUSE_UP, amendEvent.onMouseUp);
    },
    /**
     * 点击 修订信息图层的 接受修订按钮 回调
     * @param target
     */
    onAccept: function onAccept(target) {
        amend.accept(target);
    },
    /**
     * 点击 修订信息图层的 拒绝修订按钮 回调
     * @param target
     */
    onRefuse: function onRefuse(target) {
        amend.refuse(target);
    },
    /**
     * history 控件  beforeSaveSnap 保存快照之前的回调，用于在保存快照前执行必要操作
     */
    onBeforeSaveSnap: function onBeforeSaveSnap() {
        //隐藏 修订信息浮动图层，避免 undo 保存多余的图层数据
        _amendInfo2['default'].hide(true);
    },
    /**
     * history 控件  afterRestoreHistory 保存快照之后的回调，用于在保存快照后执行必要操作
     */
    onAfterRestoreHistory: function onAfterRestoreHistory() {
        //重新设置 amendInfo 的图层对象
        amend.startAmendInfo();
    },
    /**
     * 中文输入开始
     */
    onCompositionStart: function onCompositionStart() {
        //            console.log('start....');
        _commonConst2['default'].COMPOSITION_START = true;
    },
    /**
     * 中文输入结束
     */
    onCompositionEnd: function onCompositionEnd() {
        //            console.log('end....');
        _commonConst2['default'].COMPOSITION_START = false;
        //必须要延迟处理， 否则输入中文后按下 ESC 执行取消操作，触发此事件时，页面上还存在输入的中文拼音
        setTimeout(function () {
            _commonHistoryUtils2['default'].saveSnap(true);
        }, 0);
    },
    /**
     * 拖拽 文件 或 文本
     * @param e
     */
    onDragDrop: function onDragDrop(e) {
        //修订编辑时 禁用 拖拽操作，否则无法控制输入的内容
        _commonUtils2['default'].stopEvent(e);
        return false;
    },
    /**
     * 按下键盘
     * @param e
     */
    onKeyDown: function onKeyDown(e) {
        if (!_todoUtilsTodoCore2['default'].onKeyDown(e)) {
            return;
        }
        var sel = _commonEnv2['default'].doc.getSelection(),
            range,
            endDom,
            endOffset,
            nSpan,
            nSpanNext,
            nA,
            tmpSplitStr,
            tmpSplit,
            tmpParentRoot;

        //无光标时，或输入法开始后 不操作任何内容
        if (sel.rangeCount === 0 || _commonConst2['default'].COMPOSITION_START) {
            return;
        }

        var keyCode = e.keyCode || e.which;
        //      console.info(e);

        /**
         * Backspace
         */
        if (keyCode === 8) {
            _commonHistoryUtils2['default'].saveSnap(false);

            if (!sel.isCollapsed) {
                _amendUtilsAmendExtend2['default'].removeSelection(_amendUser2['default'].getCurUser());
                _amendUtilsAmendExtend2['default'].removeUserDel(null, _amendUser2['default'].getCurUser());
                sel.collapseToStart();
            } else {
                //                  console.log(endDom.nodeValue);
                _rangeUtilsRangeExtend2['default'].selectCharIncludeFillChar(true);
                _amendUtilsAmendExtend2['default'].removeSelection(_amendUser2['default'].getCurUser());
                tmpParentRoot = _rangeUtilsRangeExtend2['default'].getRangeParentRoot();
                sel.collapseToStart();

                range = sel.getRangeAt(0);
                endDom = range.startContainer;
                if (endDom.nodeType == 3) {
                    endDom = endDom.parentNode;
                }

                //保证光标移动正确， isCollapsed 的时候，必须先移动光标再做删除操作
                _amendUtilsAmendExtend2['default'].removeUserDel(tmpParentRoot, _amendUser2['default'].getCurUser());

                sel.collapseToStart();
            }
            _rangeUtilsRangeExtend2['default'].caretFocus();
            _commonUtils2['default'].stopEvent(e);
            return;
        }
        /**
         * Delete
         */
        if (keyCode === 46) {
            _commonHistoryUtils2['default'].saveSnap(false);

            if (sel.isCollapsed) {
                _rangeUtilsRangeExtend2['default'].selectCharIncludeFillChar(false);
            }
            _amendUtilsAmendExtend2['default'].removeSelection(_amendUser2['default'].getCurUser());
            _amendUtilsAmendExtend2['default'].removeUserDel(null, _amendUser2['default'].getCurUser());
            sel.collapseToEnd();

            _rangeUtilsRangeExtend2['default'].caretFocus();
            _commonUtils2['default'].stopEvent(e);
            return;
        }

        /**
         * 其他功能键一概忽略
         */
        if (_commonUtils2['default'].checkNonTxtKey(e)) {
            return;
        }

        /**
         * 普通字符
         */

        /**
         * 先执行 execCommand， 后操作 range ， 执行 execCommand 之后， endDom 会发生改变
         * 先操作 range 后执行 execCommand， 无法控制当前选中的 endDom，一旦修改里面内容， execCommand 执行的结果就出现异常
         * 使用 自己的方法直接操作 dom，放弃 execCommand
         */
        var splitInsert, amendImg;
        _commonHistoryUtils2['default'].saveSnap(false);
        if (!sel.isCollapsed) {
            _amendUtilsAmendExtend2['default'].removeSelection(_amendUser2['default'].getCurUser());
            _amendUtilsAmendExtend2['default'].removeUserDel(null, _amendUser2['default'].getCurUser());
        }
        range = sel.getRangeAt(0);
        endDom = range.endContainer;
        endOffset = range.endOffset;

        /**
         * Enter
         */
        if (keyCode === 13) {
            var delDom = _amendUtilsAmendExtend2['default'].getWizDeleteParent(endDom),
                insertDom = _amendUtilsAmendExtend2['default'].getWizInsertParent(endDom),
                isImg = !!insertDom ? _amendUtilsAmendExtend2['default'].getWizAmendImgParent(endDom) : false,
                aDom = delDom || insertDom;
            if (aDom && aDom.childNodes.length === 1 && (!_domUtilsDomExtend2['default'].isUsableTextNode(aDom.childNodes[0]) || aDom.childNodes[0].nodeType === 1 && _domUtilsDomExtend2['default'].isTag(aDom.childNodes[0], 'br'))) {
                //如果按下 Enter 键 时， 光标处于空白的 wizspan 标签内时，立刻删除该 span，避免span 的样式被 浏览器默认转换为 font 标签
                (function () {
                    var p = aDom.parentNode,
                        b = _commonEnv2['default'].doc.createElement('br');
                    p.insertBefore(b, aDom);
                    p.removeChild(aDom);
                    _rangeUtilsRangeExtend2['default'].setRange(b, 1, b, 1);
                })();
            } else if (insertDom && isImg) {
                //按下 Enter 键时，如果处于 IMG SPAN 区域内， 则直接在该区域最后添加span，避免 浏览器默认继承 样式
                (function () {
                    var s = _domUtilsDomExtend2['default'].createSpan();
                    s.innerHTML = _commonConst2['default'].FILL_CHAR;
                    _domUtilsDomExtend2['default'].before(insertDom, s, true);
                    _rangeUtilsRangeExtend2['default'].setRange(s, 1, s, 1);
                })();
            } else if (insertDom) {
                (function () {
                    var s = _domUtilsDomExtend2['default'].createSpan();
                    s.innerHTML = _commonConst2['default'].FILL_CHAR;
                    splitInsert = _amendUtilsAmendExtend2['default'].splitInsertDom(endDom, endOffset, true, _amendUser2['default'].getCurUser());
                    if (splitInsert.isInsert && splitInsert.split) {
                        _domUtilsDomExtend2['default'].before(insertDom, s, true);
                        _rangeUtilsRangeExtend2['default'].setRange(s, 1, s, 1);
                    } else if (splitInsert.isInsert) {
                        _domUtilsDomExtend2['default'].before(insertDom, s, endOffset > 0);
                        _rangeUtilsRangeExtend2['default'].setRange(s, 1, s, 1);
                    }
                })();
            } else if (delDom) {
                (function () {
                    var s = _domUtilsDomExtend2['default'].createSpan();
                    s.innerHTML = _commonConst2['default'].FILL_CHAR;
                    splitInsert = _amendUtilsAmendExtend2['default'].splitDeletedDom(endDom, endOffset);
                    if (splitInsert) {
                        _domUtilsDomExtend2['default'].before(delDom, s, true);
                        _rangeUtilsRangeExtend2['default'].setRange(s, 1, s, 1);
                    } else {
                        _domUtilsDomExtend2['default'].before(delDom, s, endOffset > 0);
                        _rangeUtilsRangeExtend2['default'].setRange(s, 1, s, 1);
                    }
                })();
            } else if (h6Patch()) {
                _commonUtils2['default'].stopEvent(e);
                return;
            }

            sel.collapseToEnd();
            return;
        }

        splitInsert = _amendUtilsAmendExtend2['default'].splitInsertDom(endDom, endOffset, false, _amendUser2['default'].getCurUser());
        amendImg = _amendUtilsAmendExtend2['default'].getWizAmendImgParent(endDom);
        if (splitInsert.isInsert && !splitInsert.split && !amendImg) {
            if (endOffset === 0 && splitInsert.insertDom.nodeType === 1) {
                //添加空字符，避免录入的字符被放到 已删除的后面
                _domUtilsDomExtend2['default'].before(splitInsert.insertDom.childNodes[0], _commonEnv2['default'].doc.createTextNode(_commonConst2['default'].FILL_CHAR), false);
                _rangeUtilsRangeExtend2['default'].setRange(splitInsert.insertDom, 1, null, null);
            } else {
                _rangeUtilsRangeExtend2['default'].setRange(endDom, endOffset, null, null);
            }

            range = sel.getRangeAt(0);
            /**
             * Tab == 4 * ' '
             */
            if (keyCode === 9) {
                range.insertNode(_domUtilsDomExtend2['default'].getTab());
                sel.modify('move', 'forward', 'character');
                sel.modify('move', 'forward', 'character');
                sel.modify('move', 'forward', 'character');
                sel.modify('move', 'forward', 'character');
                _commonUtils2['default'].stopEvent(e);
            }
            return;
        }

        nSpan = _amendUtilsAmendExtend2['default'].createDomForInsert(_amendUser2['default'].getCurUser());
        if (splitInsert.split) {
            //如果在 用户新增的 span 内操作， 则在span 拆分后，添加到 两个 span 之间
            if (endDom.nodeType == 3) {
                endDom = endDom.parentNode;
            }
            _domUtilsDomExtend2['default'].before(endDom, nSpan, endOffset > 0);
        } else if (amendImg) {
            //如果 光标处于 已修订的图片内， 则添加在 图片 容器 后面
            _domUtilsDomExtend2['default'].before(amendImg, nSpan, true);
        } else if (endDom.nodeType == 1) {
            // endDom nodeType == 1 时， 光标应该是在 childNodes[endOffset] 元素的前面
            if (endOffset < endDom.childNodes.length) {
                //避免嵌套 span ，如果 endDom 为 wizSpan 并且 内容为空或 br 时，直接删除该span
                if (endDom.getAttribute(_commonConst2['default'].ATTR.SPAN) && (endDom.childNodes.length === 0 || endDom.childNodes.length === 1 && _domUtilsDomExtend2['default'].isTag(endDom.childNodes[0], 'br'))) {
                    _domUtilsDomExtend2['default'].before(endDom, nSpan, false);
                    endDom.parentNode.removeChild(endDom);
                } else {
                    _domUtilsDomExtend2['default'].before(endDom.childNodes[endOffset], nSpan, false);
                }
            } else if (_domUtilsDomExtend2['default'].isTag(endDom, ['td', 'th']) || _domUtilsDomExtend2['default'].hasClass(endDom, _commonConst2['default'].CLASS.TODO_MAIN)) {
                //如果光标处于 表格内部，不能直接把 nSpan 放到 td 的 后面
                //也不能把 nSpan 放到 todoList Main 的后面
                if (_domUtilsDomExtend2['default'].isEmptyDom(endDom)) {
                    endDom.innerHTML = '';
                }
                endDom.appendChild(nSpan);
            } else {
                _domUtilsDomExtend2['default'].before(endDom, nSpan, true);
            }
        } else if (endDom.nodeType == 3) {
            if (_amendUtilsAmendExtend2['default'].splitDeletedDom(endDom, endOffset)) {
                _domUtilsDomExtend2['default'].before(endDom.parentNode, nSpan, true);
            } else if (endOffset < endDom.nodeValue.length) {
                tmpSplitStr = endDom.nodeValue.substr(endOffset);
                tmpSplit = _commonEnv2['default'].doc.createTextNode(tmpSplitStr);
                endDom.nodeValue = endDom.nodeValue.substr(0, endOffset);
                _domUtilsDomExtend2['default'].before(endDom, [nSpan, tmpSplit], true);
            } else {
                nA = _domUtilsDomExtend2['default'].getParentByTagName(endDom, 'a', true, null);
                nSpanNext = endDom.nextSibling;
                if (nA) {
                    //光标在 <A> 标签结尾的时候，一定要让光标进入 <A> 下一个Dom
                    _domUtilsDomExtend2['default'].before(nA, nSpan, true);
                } else if (nSpanNext) {
                    _domUtilsDomExtend2['default'].before(nSpanNext, nSpan, false);
                } else {
                    endDom.parentNode.insertBefore(nSpan, null);
                }
            }
        }

        /**
         * Tab == 4 * ' '
         */
        if (keyCode === 9) {
            nSpan.appendChild(_domUtilsDomExtend2['default'].getTab());
            _rangeUtilsRangeExtend2['default'].setRange(nSpan, 2, null, null);
            _commonUtils2['default'].stopEvent(e);
        } else {
            _rangeUtilsRangeExtend2['default'].setRange(nSpan.childNodes[0], 1, null, null);
        }

        //不能使用 selectAllChildren ，否则 输入 空格时 浏览器会自动复制前一个 span 的所有样式
        // sel.selectAllChildren(nSpan);
        //此方法会导致 Mac 的搜狗输入法 第一个字母被吃掉
        // rangeUtils.setRange(nSpan.childNodes[0], 0, nSpan.childNodes[0], nSpan.childNodes[0].nodeValue.length);
    },
    /**
     * 按下键盘 逆修订
     * @param e
     */
    onKeyDownReverse: function onKeyDownReverse(e) {
        if (!_todoUtilsTodoCore2['default'].onKeyDown(e)) {
            return;
        }
        var sel = _commonEnv2['default'].doc.getSelection();

        //无光标时，或输入法开始后 不操作任何内容
        if (sel.rangeCount === 0 || _commonConst2['default'].COMPOSITION_START) {
            return;
        }

        var keyCode = e.keyCode || e.which;
        //            console.info(e);

        var fixed = _amendUtilsAmendExtend2['default'].fixedAmendRange();
        // curCell;

        // curCell = domUtils.getParentByTagName(sel.focusNode, ['td', 'th'], true, null);

        /**
         * Backspace
         */
        if (keyCode === 8) {
            _commonHistoryUtils2['default'].saveSnap(false);

            if (sel.isCollapsed && fixed.leftDom) {
                // // 如果前一个是 table，则 delete 键直接移动光标
                // cell = domUtils.getParentByTagName(fixed.leftDom, ['td', 'th'], true, null);
                // console.log(sel.getRangeAt(0).endContainer.outerHTML);
                // console.log(sel.getRangeAt(0).endOffset);
                // console.log(fixed.leftDom);
                // if (!curCell && cell) {
                //     console.log('prev is table, stop event....')
                //     rangeUtils.setRange(cell, domUtils.getDomEndOffset(cell));
                //     utils.stopEvent(e);
                //     return;
                // }
                fixed.startImg = _amendUtilsAmendExtend2['default'].getWizAmendImgParent(fixed.leftDom);
                if (fixed.startImg) {
                    fixed.startDom = fixed.startImg;
                    fixed.startOffset = 0;
                    _rangeUtilsRangeExtend2['default'].setRange(fixed.startDom, fixed.startOffset, fixed.endDom, fixed.endOffset);
                } else if (fixed.leftDom.nodeType === 3 && fixed.leftDom.nodeValue.length == 1) {
                    fixClearLine(fixed.leftDom, -1);
                }
            }
            return;
        }
        /**
         * Delete
         */
        if (keyCode === 46) {
            _commonHistoryUtils2['default'].saveSnap(false);
            if (sel.isCollapsed && fixed.rightDom) {
                // // 如果下一个是 table，则 delete 键直接移动光标
                // var cell = domUtils.getParentByTagName(fixed.rightDom, ['td', 'th'], true, null);
                // if (!curCell && cell) {
                //     console.log('next is table, stop event....')
                //     rangeUtils.setRange(cell, 0);
                //     utils.stopEvent(e);
                //     return;
                // }
                fixed.endImg = _amendUtilsAmendExtend2['default'].getWizAmendImgParent(fixed.rightDom);
                if (fixed.endImg) {
                    fixed.endDom = fixed.endImg;
                    fixed.endOffset = fixed.endImg.childNodes.length;
                    _rangeUtilsRangeExtend2['default'].setRange(fixed.startDom, fixed.startOffset, fixed.endDom, fixed.endOffset);
                } else if (fixed.rightDom.nodeType === 3 && fixed.rightDom.nodeValue.length == 1) {
                    fixClearLine(fixed.rightDom, 1);
                }
            }
            return;
        }

        /**
         * 其他功能键一概忽略
         */
        if (_commonUtils2['default'].checkNonTxtKey(e)) {
            return;
        }

        /**
         * 普通字符
         */
        _commonHistoryUtils2['default'].saveSnap(false);
        amend.splitAmendDomByRange(fixed);
        //删除 range 选中区域后，必须要避免光标进入 table 容器内
        var check = _tableUtilsTableUtils2['default'].checkCaretInTableContainer();
        _tableUtilsTableZone2['default'].insertEmptyLine(check.tableContainer, check.after);

        if (keyCode === 13 && h6Patch()) {
            _commonUtils2['default'].stopEvent(e);
            return;
        }

        function fixClearLine(dom, direct) {
            //从右往左 Backspace  direct = -1
            //从左往右 Delete  direct = 1
            if (!dom) {
                return;
            }
            var tmpDom, wizDom;
            //专门处理 删除一行文字后， 浏览器默认记住最后删除文字样式的特性
            //此特性导致删除修订内容后， 重新输入的文字会带有修订的样式
            wizDom = _amendUtilsAmendExtend2['default'].getWizAmendParent(dom);
            if (wizDom && wizDom.childNodes.length === 1) {
                tmpDom = _domUtilsDomExtend2['default'].createSpan();
                tmpDom.innerHTML = _commonConst2['default'].FILL_CHAR + _commonConst2['default'].FILL_CHAR;
                _domUtilsDomExtend2['default'].before(wizDom, tmpDom, direct > 0);
                wizDom.parentNode.removeChild(wizDom);
                _rangeUtilsRangeExtend2['default'].setRange(tmpDom, direct > 0 ? 0 : 2, tmpDom, 1);
            }
        }
    },
    /**
     * 避免 修订信息图层被编辑  & 鼠标按下后 暂停 amendInfo 显示
     * @param e
     */
    onMouseDown: function onMouseDown(e) {
        var isInfo = _amendInfo2['default'].isInfo(e.target);
        if (isInfo) {
            _commonUtils2['default'].stopEvent(e);
        }
        _amendInfo2['default'].stop();
    },
    /**
     *  鼠标按下后 恢复 amendInfo 显示
     * @param e
     */
    onMouseUp: function onMouseUp(e) {
        _amendInfo2['default'].start();
        //var amendDoms = amendUtils.getSelectedAmendDoms();
        //
        //if (amendDoms) {
        //    console.log(amendDoms)
        //
        //    //amendInfo.showAmendsInfo(amendDoms);
        //}
    },
    onTouchStart: function onTouchStart(e) {}
};

exports['default'] = amend;

function h6Patch() {
    var range,
        block,
        hObj,
        newLine,
        isLast = false;
    // 对于 h6 在行尾 换行会导致下一行还是 h6
    range = _rangeUtilsRangeExtend2['default'].getRange();
    block = _commonEnv2['default'].doc.queryCommandValue("formatBlock");
    if (/^h[1-6]+$/i.test(block) && range && range.startOffset == _domUtilsDomExtend2['default'].getDomEndOffset(range.startContainer)) {
        hObj = _domUtilsDomExtend2['default'].getParentByTagName(range.startContainer, block, true);
        isLast = isLastDom(hObj, range.startContainer);
    }
    if (isLast && hObj) {
        newLine = _commonEnv2['default'].doc.createElement('div');
        newLine.appendChild(_commonEnv2['default'].doc.createElement('br'));
        _domUtilsDomExtend2['default'].before(hObj, newLine, true);
        _rangeUtilsRangeExtend2['default'].setRange(newLine, 0);
        return true;
    }
    return false;

    function isLastDom(parent, dom) {
        if (!parent) {
            return false;
        }
        var lastDom = _domUtilsDomExtend2['default'].getLastDeepChild(parent);
        var p = _domUtilsDomExtend2['default'].getParentByFilter(lastDom, function (obj) {
            return obj == dom;
        }, true);

        return !!p;
    }
}
module.exports = exports['default'];

},{"../common/const":13,"../common/env":15,"../common/historyUtils":16,"../common/lang":17,"../common/utils":19,"../domUtils/domExtend":24,"../rangeUtils/rangeExtend":36,"../tableUtils/tableUtils":41,"../tableUtils/tableZone":42,"../todoUtils/todoCore":43,"./amendInfo":8,"./amendUser":9,"./amendUtils/amendExtend":11}],8:[function(require,module,exports){
/**
 * 修订信息显示图层 相关对象
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _commonLang = require('../common/lang');

var _commonLang2 = _interopRequireDefault(_commonLang);

var _domUtilsDomBase = require('../domUtils/domBase');

var _domUtilsDomBase2 = _interopRequireDefault(_domUtilsDomBase);

var _amendUtilsAmendBase = require('./amendUtils/amendBase');

var _amendUtilsAmendBase2 = _interopRequireDefault(_amendUtilsAmendBase);

var _amendUser = require('./amendUser');

var _amendUser2 = _interopRequireDefault(_amendUser);

var _commonWizUserAction = require('../common/wizUserAction');

var _commonWizUserAction2 = _interopRequireDefault(_commonWizUserAction);

var callback = {
    onAccept: null,
    onRefuse: null
};
//暂停显示的标志
var pause = false,

//记录最后一次鼠标移动的位置
lastMousePos = { x: null, y: null };

var amendInfo = {
    cur: null,
    curPos: null,
    isMulti: false,
    isSelection: false,
    template: null,
    main: null,
    img: null,
    name: null,
    content: null,
    time: null,
    btnAccept: null,
    btnRefuse: null,

    /**
     * 修订信息 显示图层 初始化
     * @param options  {readonly: boolean,  cb: {onAccept: function, onRefuse: function}}
     * @param cb
     */
    init: function init(options, cb) {
        amendInfo.template = _commonEnv2['default'].doc.createElement('div');
        amendInfo.main = createAmendInfo();
        amendInfo.readonly = !!(options && options.readonly);

        _domUtilsDomBase2['default'].setContenteditable(amendInfo.main, false);

        if (cb && cb.onAccept) {
            callback.onAccept = cb.onAccept;
        }
        if (cb && cb.onRefuse) {
            callback.onRefuse = cb.onRefuse;
        }
        _event.unbind();
        _event.bind();
    },
    /**
     * 删除 修订信息 图层
     */
    remove: function remove() {
        _event.unbind();
        removeAmendInfo();
        amendInfo.main = null;
        amendInfo.img = null;
        amendInfo.name = null;
        amendInfo.content = null;
        amendInfo.time = null;
        amendInfo.btnAccept = null;
        amendInfo.btnRefuse = null;
    },
    /**
     * 显示 修订信息
     * @param dom
     * @param pos
     */
    show: function show(dom, pos) {
        clearTimeout(amendInfo.showTimer);
        clearTimeout(amendInfo.hideTimer);

        var isSelection = _commonUtils2['default'].isArray(dom),
            isMulti = isSelection && dom.length > 1,
            cur = !isSelection ? dom : isMulti ? null : dom[0],
            showFlag = false;

        amendInfo.isSelection = isSelection;
        if (amendInfo.isMulti !== isMulti || cur !== amendInfo.cur) {

            //移动到不同的 dom 时，立刻隐藏当前标签， 等待固定时间后再显示信息
            amendInfo.hide(true);

            showFlag = true;
        } else if (!amendInfo.curPos || Math.abs(amendInfo.curPos.left - pos.left) > 75 || Math.abs(amendInfo.curPos.top - pos.top) > 24) {
            //在同一个 dom 内移动距离较远后， 更换信息图层位置
            showFlag = true;
        }

        if (showFlag) {
            amendInfo.showTimer = setTimeout(function () {
                amendInfo.isMulti = isMulti;
                amendInfo.cur = cur;
                showInfo(pos);
            }, _commonConst2['default'].AMEND.INFO_TIMER * 2);
        }
    },
    /**
     * 隐藏 修订信息
     * @param quick
     */
    hide: function hide(quick) {
        clearTimeout(amendInfo.showTimer);
        clearTimeout(amendInfo.hideTimer);
        if (!amendInfo.cur && !amendInfo.isMulti) {
            return;
        }

        if (quick) {
            hideInfo();
        } else {
            amendInfo.hideTimer = setTimeout(hideInfo, _commonConst2['default'].AMEND.INFO_TIMER);
        }
    },
    /**
     * 判断 dom 是否 amendInfo layer 内的元素（包括layer）
     * @param dom
     */
    isInfo: function isInfo(dom) {
        var amendInfoMain = _domUtilsDomBase2['default'].getParentByFilter(dom, function (node) {
            return node == amendInfo.main;
        }, true);
        return !!amendInfoMain;
    },
    /**
     * 恢复 info 的显示
     */
    start: function start() {
        pause = false;
    },
    /**
     * 暂停 info 的显示
     */
    stop: function stop() {
        amendInfo.hide(true);
        pause = true;
    }
};

var _event = {
    bind: function bind() {
        if (_commonEnv2['default'].client.type.isIOS || _commonEnv2['default'].client.type.isAndroid) {
            _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_TOUCH_START, _event.handler.onTouchstart);
            _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_TOUCH_END, _event.handler.onMouseMove);
        } else {
            _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_MOUSE_MOVE, _event.handler.onMouseMove);
        }
    },
    unbind: function unbind() {
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_TOUCH_START, _event.handler.onTouchstart);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_TOUCH_END, _event.handler.onMouseMove);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_MOUSE_MOVE, _event.handler.onMouseMove);
    },
    bindInfoBtn: function bindInfoBtn() {
        _event.unbindInfoBtn();
        if (_commonEnv2['default'].client.type.isIOS || _commonEnv2['default'].client.type.isAndroid) {
            amendInfo.main.addEventListener('touchend', _event.handler.onClick);
        } else {
            amendInfo.main.addEventListener('click', _event.handler.onClick);
        }
    },
    unbindInfoBtn: function unbindInfoBtn() {
        if (_commonEnv2['default'].client.type.isIOS || _commonEnv2['default'].client.type.isAndroid) {
            amendInfo.main.removeEventListener('touchend', _event.handler.onClick);
        } else {
            amendInfo.main.removeEventListener('click', _event.handler.onClick);
        }
    },

    handler: {
        /**
         * 检测 鼠标移动到的 dom 对象，是否需要显示 或 隐藏 amendInfo
         * @param e
         */
        onMouseMove: function onMouseMove(e) {
            //console.log('onMouseMove....')
            var eventClient = _commonUtils2['default'].getEventClientPos(e);
            //如果鼠标没有移动， 仅仅输入文字导致触发mousemove事件时，不弹出信息框
            if (lastMousePos.x === eventClient.x && lastMousePos.y === eventClient.y) {
                return;
            }
            lastMousePos = eventClient;
            if (pause) {
                return;
            }
            var target = e.target,
                isInfo = amendInfo.isInfo(target),
                scroll,
                pos = {
                width: 20,
                height: 20
            };

            //在 修订信息图层内移动， 不进行任何操作
            if (isInfo) {
                clearTimeout(amendInfo.showTimer);
                clearTimeout(amendInfo.hideTimer);
                return;
            }

            var sel = _commonEnv2['default'].doc.getSelection(),
                selectedDoms,
                targetDom = _amendUtilsAmendBase2['default'].getWizDeleteParent(target) || _amendUtilsAmendBase2['default'].getWizInsertParent(target);

            if (!sel.isCollapsed && targetDom && sel.containsNode(targetDom, true)) {
                //有选择区域， 且 target 在选择区域内
                selectedDoms = sel.isCollapsed ? null : _amendUtilsAmendBase2['default'].getAmendDoms({
                    selection: true,
                    selectAll: false
                });
            }

            //校验选择区域内是否有多个dom
            if (selectedDoms) {
                selectedDoms = selectedDoms.deletedInsertList.concat(selectedDoms.insertList, selectedDoms.deleteList);
                //选择多个修订内容时，不显示详细信息
                if (selectedDoms.length === 0) {
                    selectedDoms = null;
                    //} else if (selectedDoms.length == 1) {
                    //    targetDom = selectedDoms[0];
                    //    selectedDoms = null;
                }
            }
            var fontSize;
            if (selectedDoms || targetDom) {
                fontSize = parseInt(_commonEnv2['default'].win.getComputedStyle(targetDom)['font-size']);
                if (isNaN(fontSize)) {
                    fontSize = 14;
                }
                scroll = _domUtilsDomBase2['default'].getPageScroll();
                pos.left = eventClient.x + scroll.left;
                pos.top = eventClient.y + scroll.top - fontSize;
                if (pos.top < targetDom.offsetTop) {
                    pos.top = targetDom.offsetTop;
                }
                amendInfo.show(selectedDoms || targetDom, pos);
            } else {
                amendInfo.hide(false);
            }
        },
        onTouchstart: function onTouchstart(e) {
            //console.log('onTouchstart....')
            var target = e.target,
                isInfo = amendInfo.isInfo(target);
            if (isInfo) {
                return;
            }
            amendInfo.hide(false);
        },

        onClick: function onClick(e) {
            var target;
            if (e.changedTouches) {
                target = e.changedTouches[0].target;
            } else {
                target = e.target;
            }
            if (target.id == _commonConst2['default'].ID.AMEND_INFO_ACCEPT) {
                _event.handler.onAccept(e);
            } else if (target.id == _commonConst2['default'].ID.AMEND_INFO_REFUSE) {
                _event.handler.onRefuse(e);
            }
            _commonUtils2['default'].stopEvent(e);
        },
        onAccept: function onAccept(e) {
            if (callback.onAccept) {
                callback.onAccept(getCallbackParams());
            }
            amendInfo.hide(true);
            _commonWizUserAction2['default'].save(_commonWizUserAction2['default'].ActionId.ClickAcceptFromAmendInfo);
        },
        onRefuse: function onRefuse(e) {
            if (callback.onRefuse) {
                callback.onRefuse(getCallbackParams());
            }
            amendInfo.hide(true);
            _commonWizUserAction2['default'].save(_commonWizUserAction2['default'].ActionId.ClickRefuseFromAmendInfo);
        }
    }
};

/**
 * 创建 修订信息 图层
 */
function createAmendInfo() {
    var mask = _commonEnv2['default'].doc.getElementById(_commonConst2['default'].ID.AMEND_INFO),
        container;
    if (!mask) {
        mask = _commonEnv2['default'].doc.createElement('div');
        container = _commonEnv2['default'].doc.createElement('div');
        _domUtilsDomBase2['default'].setContenteditable(container, false);
        mask.appendChild(container);
        mask.id = _commonConst2['default'].ID.AMEND_INFO;
        _domUtilsDomBase2['default'].css(mask, {
            'position': 'absolute',
            'z-index': _commonConst2['default'].CSS.Z_INDEX.amendInfo,
            'display': 'none',
            'padding': '6px',
            'font-family': '"Microsoft Yahei","微软雅黑",Helvetica,SimSun,SimHei'
        }, false);
        container.innerHTML = getInfoTemplate();

        _domUtilsDomBase2['default'].css(container, {
            'background-color': 'white',
            'padding': '0px',
            'font-size': '12px',
            'border': '1px solid #D8D8D8',
            '-webkit-border-radius': '4px',
            '-moz-border-radius': '4px',
            '-border-radius': '4px',
            '-webkit-box-shadow': 'rgba(0, 0, 0, 0.24) 0px 3px 3px',
            '-moz-box-shadow': 'rgba(0, 0, 0, 0.24) 0px 3px 3px',
            'box-shadow': 'rgba(0, 0, 0, 0.24) 0px 3px 3px',
            'min-width': '160px',
            'max-width': '280px',
            'min-height': '50px'
        }, false);

        amendInfo.template.appendChild(mask);
    }
    return mask;
}

function getInfoTemplate() {
    if (_commonEnv2['default'].client.type.isIOS || _commonEnv2['default'].client.type.isMac || _commonEnv2['default'].client.type.isAndroid) {
        return '<div id="' + _commonConst2['default'].ID.AMEND_INFO_SINGLE + '" style="display:none; padding: 8px 16px;">' + '<img id="' + _commonConst2['default'].ID.AMEND_INFO_IMG + '" class="' + _commonConst2['default'].CLASS.IMG_NOT_DRAG + '" style="width: 40px; height: 40px !important; position: absolute; -webkit-border-radius: 40px;-moz-border-radius:40px;border-radius:40px;">' + '<ul style="list-style-type: none;margin: 4px 0 0 50px;padding-left: 0;"><li style="line-height: 18px;white-space: nowrap;padding: 2px 0;">' + '<span id="' + _commonConst2['default'].ID.AMEND_INFO_NAME + '" style="color:#000;font-size:12px;font-weight:bold;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;"></span>' + '<span id="' + _commonConst2['default'].ID.AMEND_INFO_CONTENT + '" style="color:#000;font-size:12px;margin-left:.5em;display:inline-block;overflow:hidden;float:right"></span>' + '</li><li style="line-height: 18px;text-align: right;">' + '<span id="' + _commonConst2['default'].ID.AMEND_INFO_TIME + '" style="color:#A3A3A3;font-size:12px;"></span></li></ul>' + '</div>' + '<div id="' + _commonConst2['default'].ID.AMEND_INFO_MULTI + '" style="display:none; padding: 8px 16px;">' + '<p style="margin: 4px 16px;">' + _commonLang2['default'].Amend.MultiInfo + '</p>' + '</div>' + '<div id="' + _commonConst2['default'].ID.AMEND_INFO_TOOLS + '" style="padding:0;margin:0;box-sizing: border-box;">' + '<div style="line-height: 26px;width: 50%;display:inline-block;text-align: center;padding:0 8px;margin:0;box-sizing: border-box;">' + '<a id="' + _commonConst2['default'].ID.AMEND_INFO_REFUSE + '" href="javascript:void(0);" style="font-size:12px;display:block;cursor:pointer;color:#447BD8;text-decoration: blink;">' + _commonLang2['default'].Amend.BtnRefuse + '</a></div>' + '<div style="line-height: 26px;width: 50%;display:inline-block;text-align: center;padding:0 8px;margin:0;box-sizing: border-box;">' + '<a id="' + _commonConst2['default'].ID.AMEND_INFO_ACCEPT + '" href="javascript:void(0);" style="font-size:12px;display:block;cursor:pointer;color:#447BD8;text-decoration: blink;">' + _commonLang2['default'].Amend.BtnAccept + '</a></div>' + '</div>';
    }

    //if (ENV.client.type.isWeb || ENV.client.type.isWin) {
    return '<div id="' + _commonConst2['default'].ID.AMEND_INFO_SINGLE + '" style="display:none; padding: 8px 16px;">' + '<img id="' + _commonConst2['default'].ID.AMEND_INFO_IMG + '" class="' + _commonConst2['default'].CLASS.IMG_NOT_DRAG + '" style="width: 40px; height: 40px !important; position: absolute;">' + '<ul style="list-style-type: none;margin: 4px 0 0 50px;padding-left: 0;"><li style="line-height: 18px;white-space: nowrap;padding: 2px 0;">' + '<span id="' + _commonConst2['default'].ID.AMEND_INFO_NAME + '" style="color:#000;font-size:12px;font-weight:bold;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;"></span>' + '<span id="' + _commonConst2['default'].ID.AMEND_INFO_CONTENT + '" style="color:#000;font-size:12px;margin-left:.5em;display:inline-block;overflow:hidden;float:right"></span>' + '</li><li style="line-height: 18px;text-align: right;">' + '<span id="' + _commonConst2['default'].ID.AMEND_INFO_TIME + '" style="color:#A3A3A3;font-size:12px;"></span></li></ul>' + '</div>' + '<div id="' + _commonConst2['default'].ID.AMEND_INFO_MULTI + '" style="display:none; padding: 8px 16px;">' + '<p style="margin: 4px 16px;">' + _commonLang2['default'].Amend.MultiInfo + '</p>' + '</div>' + '<div id="' + _commonConst2['default'].ID.AMEND_INFO_TOOLS + '" style="padding:0;margin:0;box-sizing:border-box;border-top:1px solid #D8D8D8">' + '<div style="line-height: 26px;width: 50%;display:inline-block;text-align: center;padding:0 8px;margin:0;box-sizing: border-box;border-right: 1px solid #D8D8D8">' + '<a id="' + _commonConst2['default'].ID.AMEND_INFO_ACCEPT + '" href="javascript:void(0);" style="font-size:12px;display:block;cursor:pointer;color:#447BD8;text-decoration: blink;">' + _commonLang2['default'].Amend.BtnAccept + '</a></div>' + '<div style="line-height: 26px;width: 50%;display:inline-block;text-align: center;padding:0 8px;margin:0;box-sizing: border-box;">' + '<a id="' + _commonConst2['default'].ID.AMEND_INFO_REFUSE + '" href="javascript:void(0);" style="font-size:12px;display:block;cursor:pointer;color:#447BD8;text-decoration: blink;">' + _commonLang2['default'].Amend.BtnRefuse + '</a></div>' + '</div>';
    //}
}

function getCallbackParams() {
    return {
        dom: amendInfo.cur,
        isSelection: !!amendInfo.isSelection
    };
}

function initUserInfo(pos) {
    var dom = amendInfo.cur,
        guid = dom.getAttribute(_commonConst2['default'].ATTR.SPAN_USERID),
        user = _amendUser2['default'].getUserByGuid(guid),
        name = user ? user.name : _commonLang2['default'].Amend.UserNameDefault,
        time = dom.getAttribute(_commonConst2['default'].ATTR.SPAN_TIMESTAMP),
        isDelete = !!dom.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE),
        user = _amendUser2['default'].getUserByGuid(guid);
    time = time.substring(0, time.length - 3);

    amendInfo.curPos = pos;
    amendInfo.img.src = user ? user.imgUrl : '';
    amendInfo.name.innerText = name;
    amendInfo.name.setAttribute('title', name);
    amendInfo.content.innerText = isDelete ? _commonLang2['default'].Amend.Delete : _commonLang2['default'].Amend.Edit;
    amendInfo.time.innerText = time;

    amendInfo.multiUser.style.display = 'none';
    amendInfo.singleUser.style.display = 'block';
}

function initMultiInfo(pos) {
    amendInfo.curPos = pos;
    amendInfo.singleUser.style.display = 'none';
    amendInfo.multiUser.style.display = 'block';
}

function showInfo(pos) {

    if (amendInfo.main.parentNode == amendInfo.template) {
        _commonEnv2['default'].doc.body.appendChild(amendInfo.main);
        amendInfo.singleUser = _commonEnv2['default'].doc.getElementById(_commonConst2['default'].ID.AMEND_INFO_SINGLE);
        amendInfo.multiUser = _commonEnv2['default'].doc.getElementById(_commonConst2['default'].ID.AMEND_INFO_MULTI);
        amendInfo.img = _commonEnv2['default'].doc.getElementById(_commonConst2['default'].ID.AMEND_INFO_IMG);
        amendInfo.name = _commonEnv2['default'].doc.getElementById(_commonConst2['default'].ID.AMEND_INFO_NAME);
        amendInfo.content = _commonEnv2['default'].doc.getElementById(_commonConst2['default'].ID.AMEND_INFO_CONTENT);
        amendInfo.time = _commonEnv2['default'].doc.getElementById(_commonConst2['default'].ID.AMEND_INFO_TIME);
        amendInfo.tools = _commonEnv2['default'].doc.getElementById(_commonConst2['default'].ID.AMEND_INFO_TOOLS);
        amendInfo.btnAccept = _commonEnv2['default'].doc.getElementById(_commonConst2['default'].ID.AMEND_INFO_ACCEPT);
        amendInfo.btnRefuse = _commonEnv2['default'].doc.getElementById(_commonConst2['default'].ID.AMEND_INFO_REFUSE);
    }

    if (amendInfo.cur) {
        initUserInfo(pos);
    } else {
        initMultiInfo(pos);
    }

    _event.bindInfoBtn();

    if (amendInfo.readonly) {
        amendInfo.tools.style.display = 'none';
    } else {
        amendInfo.tools.style.display = 'block';
    }

    _domUtilsDomBase2['default'].css(amendInfo.main, {
        'top': '0px',
        'left': '0px',
        'display': 'block',
        'visibility': 'hidden'
    }, false);
    _domUtilsDomBase2['default'].setLayout({
        layerObj: amendInfo.main,
        target: pos,
        layout: _commonConst2['default'].TYPE.POS.upLeft,
        fixed: false,
        noSpace: false,
        reverse: true
        //reverse: !ENV.client.type.isPhone
    });
    _domUtilsDomBase2['default'].css(amendInfo.main, {
        'display': 'block',
        'visibility': 'visible'
    }, false);
}

function hideInfo() {
    if (amendInfo.main) {
        _event.unbindInfoBtn();
        amendInfo.cur = null;
        amendInfo.curPos = null;
        amendInfo.isMulti = false;
        amendInfo.isSelection = false;
        amendInfo.img.src = '';
        amendInfo.name.innerText = '';
        amendInfo.name.setAttribute('title', '');
        amendInfo.content.innerText = '';
        _domUtilsDomBase2['default'].css(amendInfo.main, {
            'display': 'none'
        }, false);
        amendInfo.template.appendChild(amendInfo.main);
    }
}

/**
 * 删除 修订信息 图层
 */
function removeAmendInfo() {
    var d = _commonEnv2['default'].doc.getElementById(_commonConst2['default'].ID.AMEND_INFO);
    if (!!d) {
        d.parentNode.removeChild(d);
    }
}

exports['default'] = amendInfo;
module.exports = exports['default'];

},{"../common/const":13,"../common/env":15,"../common/lang":17,"../common/utils":19,"../common/wizUserAction":21,"../domUtils/domBase":23,"./amendUser":9,"./amendUtils/amendBase":10}],9:[function(require,module,exports){
/**
 * 用于记录 当前操作者的信息
 * @type {{guid: string, hash: string, name: string, color: string, init: Function}}
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var DefaultImg = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAtCAYAAAA6GuKaAAAExUlEQVRYR9WZz08bRxTHvya1CHbUSHXCiZzCIaaBBOUUEveQSORWYwwRxRCpqtIqjZL8XQkEUppAbQMX6hgh5UetRiFV4MABQXoK2AgUx1vNzs7u7Hpmf3m3Vc3Blm2Gz/vOd95784goiqLgf/aIhAVdrVaxu7sLKomC7u7uwKQJBPrFi5eoVvfx6VMdZONOnIhjf78KBQoINQEnrwcuD+DkyS9bhvcNfXR0hFKppEKqWqp8BE0l1N7XgPXvKOjq6kJfX29L4L6hCfDh4aEnYBbQjRuD+PhxD4nEV77gfUEvLy/rXm1S2GIJQ3VtJ9TdoFtDfuKxOK5fv+YJ3jM0BfZmCd4y5tcUPp3+Njzo1dVV1Go1X5Yw+Z1oTOLWVI91HMfg4KBrcE9KLy0tq+mrVUvwwGSxzs5ODAxcDgt6yXWWcLIEVd5QezgzFA704iKBdk5rQmCLJdRzwYEPD2fCgS4WF408LMkSooOmhsl5mBYcTmlFQTY7HA50oVi0LRxeLcHDj4QGXShKK50jsGpfsyWY2uR5dCQbjtL5QsHUSzgVDidL8AcxNOiVlRXUagdccTEfSqGfLVmCt4RRpBTcHB0JR+lS6Tn29va04iIBdsgSvCVoxlMQ/SKKTCYdPPT29jb+qFSEB5HvJbxYgnqctq2958+jpyfpCtx1RVxY+M1eYUsKYyrqAWmf85ZgwAx+bOxm8ND0D4rLOK+wXZbQg+F6bALfQAOj2Syi0agjuGul5+cXTA1+EJbg7UFeZ4bS6OjoCA762fy87udWsoTMHkT43PiYIzD5gmul19bW8OHD36Yy7tUSVg/T8q6VeCjIjX8XLDRZ/OkzojZNdX6zhNUSzOPEGrFYLFhotlpxcQkHBwdaZTS3l7LCYWeJeDyGoTBvLgy8XC5jl1jFppeQZQm/luC3wLWn+V9qNBqYm/u1qb3kewmZDXjVe5JJ9PdfdGWJlqHJAk9+mQOBl1nC6dCRTZrIuTt41qh8Kc0WmZmZ1dXmFbTzMCtOly71I3nunGeVPaU80eo7Ozv4vfRcvzY1WULrK8wBqW7HRG7cF3DL0GSBqenHRk9iKc3WQ8eGka0ABwZtpzADNZ4VTE7kfKscCPSjqWm9vZRnDGoJVv1uTf7H0A8fTen24DOGSGH23q3JiX9f6Xq9jnfv/sKfb954BmbTqYsX+nDmTBcSiYTnAFynvK2tLZDhef3zZ60S0huHLNXxHrZTnXwWiUTQffYsUqkrrgKQQpMLbD6fF+ZhN4WD9zB/cTC/ZsN3YwysN1CZNE6fOiUMwgT99u061tfXjRmb4IrkpnCIgOVBNAObdg/A1z1JfJO6qgegQ5fLqyDFwnqnY/M2L4WD75GZh5nCIqWlFqOyq7sdaWvDnZ9uq+A69Ozsk1AUtt4rhd2fNkpg4wWzULT9JZ/d/uF7tLe3U+iNjU1tPGAMBu1uzbJKZ1W4FUuIhpQX+nqRSl2l0O/fb6BSqZhbTX32xmUJm14iVGCN5VjbMfx850cK/erVa2xuburb4LaBl6U1mSVE6zpZwphhE4s0cP/eXQqdzxewX61Kcy6bS9ComPLm0ixKa34PXXMyoMDkoUNPP56Rt5fcITGUEgMH6mGLPdl/fh/cv4t/ANultPKz243RAAAAAElFTkSuQmCC';

var AmendUser = function AmendUser(userInfo) {
    if (!userInfo) {
        userInfo = {};
    }
    this.guid = userInfo.user_guid || '';
    this.hash = getHash(this.guid);
    this.name = userInfo.user_name || '';
    this.imgUrl = userInfo.img_url ? userInfo.img_url : getImgUrl(this.guid);
    this.color = userInfo.color || createUserColor(this);
};
var curAmendUser = null;
var userDom = null;
var users = null,
    //用户 AmendUser 对象集合，用于 修订功能
usersForSave = null; //用户 保存数据，用于保存到 meta 内

var amendUserUtils = {
    initUser: function initUser(userInfo) {
        //初始化用户信息， 保证第一个修订用户的信息能被正常保存
        loadUsers();

        if (!userInfo) {
            return null;
        }

        curAmendUser = new AmendUser(userInfo);
        addUser(curAmendUser);
    },
    getCurUser: function getCurUser() {
        saveUser();
        return curAmendUser;
    },
    getUserByGuid: function getUserByGuid(guid) {
        if (curAmendUser && guid === curAmendUser.guid) {
            return curAmendUser;
        }
        if (users && users[guid]) {
            return users[guid];
        }
        loadUsers();
        return users[guid];
    },
    /**
     * 删除 修订颜色数据（用于确认修订）
     */
    removeAllUserInfo: function removeAllUserInfo() {
        var d = _commonEnv2['default'].doc.getElementById(_commonConst2['default'].ID.AMEND_USER_INFO);
        if (!!d) {
            d.parentNode.removeChild(d);
        }
        userDom = null;
        users = null;
        usersForSave = null;
    },
    setUsersData: function setUsersData(_usersData) {
        var i, j, u, u1, u2;
        if (!_usersData) {
            return;
        }
        for (i = 0, j = _usersData.length; i < j; i++) {
            u = _usersData[i];
            u1 = users[u.user_guid];
            u2 = usersForSave[u.user_guid];
            if (u1 && u.user_name) {
                u1.name = u.user_name;
            }
            if (u1 && u.img_url) {
                u1.imgUrl = u.img_url;
            }
            if (u2 && u.user_name) {
                u2.name = u.user_name;
            }
        }
    }
};

function getHash(guid) {
    //hash = util.getHash(userInfo.user_guid);
    //hash = '_w' + hash;
    return guid;
}

function getImgUrl(guid) {
    if (_commonEnv2['default'].client.type.isWeb) {
        return '/wizas/a/users/avatar/' + guid + '?default=true&_' + new Date().valueOf();
    } else if (_commonEnv2['default'].client.type.isWin) {
        try {
            var avatarFileName = external.GetAvatarByUserGUID(guid);
            return avatarFileName ? avatarFileName : DefaultImg;
        } catch (e) {
            console.log(e);
        }
    } else if (_commonEnv2['default'].client.type.isMac) {} else if (_commonEnv2['default'].client.type.isIOS) {} else if (_commonEnv2['default'].client.type.isAndroid) {}

    return DefaultImg;
}
/**
 * 从客户端根据 guid 获取最新的用户昵称， 保证显示最新的用户昵称
 * @param guid
 * @returns {*}
 */
function getUserNameFromClient(guid) {
    if (_commonEnv2['default'].client.type.isWeb) {} else if (_commonEnv2['default'].client.type.isWin) {
        try {
            var userName = external.GetAliasByUserGUID(guid);
            return userName;
        } catch (e) {
            console.log(e);
        }
    } else if (_commonEnv2['default'].client.type.isMac) {} else if (_commonEnv2['default'].client.type.isIOS) {} else if (_commonEnv2['default'].client.type.isAndroid) {}

    return null;
}

function getUserDom() {
    if (userDom) {
        return userDom;
    }
    userDom = _commonEnv2['default'].doc.getElementById(_commonConst2['default'].ID.AMEND_USER_INFO);
    return userDom;
}
function createUserDom() {
    userDom = _commonEnv2['default'].doc.createElement('meta');
    userDom.id = _commonConst2['default'].ID.AMEND_USER_INFO;
    userDom.name = _commonConst2['default'].ID.AMEND_USER_INFO;
    _commonEnv2['default'].doc.getElementsByTagName('HEAD')[0].insertBefore(userDom, null);
}

function loadUsers() {
    if (users) {
        return;
    }
    var i, u, tmpName;

    users = {};
    usersForSave = {};

    userDom = getUserDom();
    if (!userDom) {
        return;
    }

    try {
        //根据已有数据获取曾经修订过的用户信息
        usersForSave = JSON.parse(userDom.content);

        for (i in usersForSave) {
            if (usersForSave.hasOwnProperty(i)) {
                u = usersForSave[i];
                u.user_guid = i;
                tmpName = getUserNameFromClient(i);
                if (tmpName) {
                    u.user_name = tmpName;
                } else {
                    u.user_name = u.name;
                }

                users[i] = new AmendUser(u);
            }
        }
    } catch (e) {}
}

/**
 * 根据 user 信息生成 修订颜色
 * @param user
 */
function createUserColor(user) {
    var userKey = user.hash,
        colorCount = _commonConst2['default'].COLOR.length,
        tmpColors = {},
        i,
        c;

    loadUsers();
    //如果该用户已有修订记录，直接使用
    if (users[userKey]) {
        return users[userKey].color;
    }

    //初始化 颜色列表，确认哪些颜色已被使用
    for (i in users) {
        if (users.hasOwnProperty(i)) {
            c = users[i].color;
            tmpColors[c] = true;
        }
    }

    for (i = 0; i < colorCount; i++) {
        c = _commonConst2['default'].COLOR[i];
        if (!tmpColors[c]) {
            return c;
        }
    }
    //如果所有颜色都被使用， 则直接使用第一种颜色
    return _commonConst2['default'].COLOR[0];
}

function addUser(user) {
    //如果已经存在，则替换数据
    users[user.guid] = user;
    usersForSave[user.guid] = {
        color: user.color,
        name: user.name
    };
}
function saveUser() {
    if (!userDom) {
        createUserDom();
    }

    userDom.content = JSON.stringify(usersForSave);
}

exports['default'] = amendUserUtils;
module.exports = exports['default'];

},{"../common/const":13,"../common/env":15,"../common/utils":19}],10:[function(require,module,exports){
/**
 * amend 中通用的基本方法集合（基础操作，以读取为主）
 *
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('../../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('../../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('../../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _domUtilsDomBase = require('../../domUtils/domBase');

var _domUtilsDomBase2 = _interopRequireDefault(_domUtilsDomBase);

var _rangeUtilsRangeBase = require('../../rangeUtils/rangeBase');

var _rangeUtilsRangeBase2 = _interopRequireDefault(_rangeUtilsRangeBase);

var _amendUser = require('./../amendUser');

var _amendUser2 = _interopRequireDefault(_amendUser);

var amendUtils = {
    /**
     * 根据条件 获取 修订的 dom 集合
     * @param options  {{[selection]: Boolean, [domList]: Array, [selectAll]: Boolean}}
     * @returns {{insertList: Array, deleteList: Array, deletedInsertList: Array}}
     */
    getAmendDoms: function getAmendDoms(options) {
        var i,
            j,
            d,
            insertAttr = {},
            deleteAttr = {},
            result = {
            insertList: [],
            deleteList: [],
            deletedInsertList: []
        },
            tmp = [];
        if (options.selection) {
            insertAttr[_commonConst2['default'].ATTR.SPAN_INSERT] = '';
            result.insertList = amendUtils.getWizSpanFromRange(options.selectAll, insertAttr);
            //清理出 删除&新增内容
            result.deletedInsertList = _domUtilsDomBase2['default'].removeListFilter(result.insertList, function (dom) {
                return dom.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE);
            });
            deleteAttr[_commonConst2['default'].ATTR.SPAN_DELETE] = '';
            result.deleteList = amendUtils.getWizSpanFromRange(options.selectAll, deleteAttr);
            //清理出 删除&新增内容
            tmp = _domUtilsDomBase2['default'].removeListFilter(result.deleteList, function (dom) {
                return dom.getAttribute(_commonConst2['default'].ATTR.SPAN_INSERT);
            });
            //合并从 insert & delete 集合中 清理出来的 删除&新增内容
            result.deletedInsertList = _commonUtils2['default'].removeDup(result.deletedInsertList.concat(tmp));
        } else {
            for (i = 0, j = options.domList.length; i < j; i++) {
                d = options.domList[i];
                if (d.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE) && d.getAttribute(_commonConst2['default'].ATTR.SPAN_INSERT)) {
                    result.deletedInsertList.push(d);
                } else if (d.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE)) {
                    result.deleteList.push(d);
                } else if (d.getAttribute(_commonConst2['default'].ATTR.SPAN_INSERT)) {
                    result.insertList.push(d);
                }
            }
        }
        return result;
    },
    /**
     * 获取 与目标 连续且时间戳相近的 修订 dom 集合(必须同一用户的操作)
     * @param dom
     * @returns {Array}
     */
    getSameTimeStampDom: function getSameTimeStampDom(dom) {
        if (!dom || dom.nodeType != 1) {
            return [];
        }
        var result = [];

        findWizSibling(dom, true, result);
        result.push(dom);
        findWizSibling(dom, false, result);
        return result;

        function findWizSibling(target, isPrev, result) {
            var wizAmend,
                tmp,
                amendTypeTmp,
                amendType = getAmendType(target),
                time = target.getAttribute(_commonConst2['default'].ATTR.SPAN_TIMESTAMP),
                userId = target.getAttribute(_commonConst2['default'].ATTR.SPAN_USERID);
            if (!time) {
                return;
            }
            var sibling = getSibling(target, isPrev);
            while (sibling) {
                wizAmend = amendUtils.getWizInsertParent(sibling) || amendUtils.getWizDeleteParent(sibling);
                sibling = wizAmend;
                //首先判断是否同一用户
                if (sibling && sibling.getAttribute(_commonConst2['default'].ATTR.SPAN_USERID) !== userId) {
                    sibling = null;
                } else if (sibling) {
                    tmp = sibling.getAttribute(_commonConst2['default'].ATTR.SPAN_TIMESTAMP);
                    amendTypeTmp = getAmendType(sibling);
                    //时间相近的算法必须要考虑 删除其他用户新增的情况， 如果目标是（delete & insert）的情况，则相邻的也必须满足
                    if (amendType === amendTypeTmp && _commonUtils2['default'].isSameAmendTime(sibling.getAttribute(_commonConst2['default'].ATTR.SPAN_TIMESTAMP), time)) {
                        if (isPrev) {
                            result.splice(0, 0, sibling);
                        } else {
                            result.push(sibling);
                        }
                        sibling = getSibling(sibling, isPrev);
                    } else {
                        sibling = null;
                    }
                }
            }
        }

        function getAmendType(obj) {
            if (obj.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE) && obj.getAttribute(_commonConst2['default'].ATTR.SPAN_INSERT)) {
                return 1;
            } else if (obj.getAttribute(_commonConst2['default'].ATTR.SPAN_INSERT)) {
                return 2;
            } else if (obj.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE)) {
                return 3;
            }
            return 0;
        }

        function getSibling(target, isPrev) {
            return isPrev ? _domUtilsDomBase2['default'].getPreviousNode(target, false, null) : _domUtilsDomBase2['default'].getNextNode(target, false, null);
        }
    },
    /**
     * 获取选择范围内 修订 dom 集合
     * @returns {*}
     */
    getSelectedAmendDoms: function getSelectedAmendDoms() {
        var sel = _commonEnv2['default'].doc.getSelection(),
            range = sel.getRangeAt(0),
            startDom,
            endDom,
            startOffset,
            endOffset;

        var amends = amendUtils.getAmendDoms({
            selection: true,
            selectAll: false
        });
        if (amends.insertList.length === 0 && amends.deleteList.length === 0 && amends.deletedInsertList.length === 0) {
            return null;
        }

        if (sel.isCollapsed) {
            //光标折叠状态时，不需要对 span 进行拆分
            return amends;
        }

        startDom = range.startContainer;
        startOffset = range.startOffset;
        endDom = range.endContainer;
        endOffset = range.endOffset;

        var start = checkStart(amends.deleteList, startDom, startOffset);
        if (!start) {
            start = checkStart(amends.insertList, startDom, startOffset);
            if (!start) {
                start = checkStart(amends.deletedInsertList, startDom, startOffset);
            }
        }
        var end = {};
        if (endDom === startDom && !!start) {
            end.dom = start.dom;
            end.offset = endOffset;
        } else {
            end = checkEnd(amends.deleteList, endDom, endOffset);
            if (!end) {
                end = checkEnd(amends.insertList, endDom, endOffset);
                if (!end) {
                    end = checkEnd(amends.deletedInsertList, endDom, endOffset);
                }
            }
        }

        amends.start = start;
        amends.end = end;

        return amends;

        function checkStart(list, startDom, startOffset) {
            if (list.length === 0 || startOffset === 0) {
                return null;
            }
            var s = list[0];
            if (s === startDom || _domUtilsDomBase2['default'].contains(s, startDom)) {
                list.splice(0, 1);
                return {
                    dom: startDom,
                    offset: startOffset
                };
            }
            return null;
        }

        function checkEnd(list, endDom, endOffset) {
            if (list.length === 0) {
                return null;
            }
            var maxLength = endDom.nodeType === 3 ? endDom.length : endDom.childNodes.length;
            if (endOffset === maxLength) {
                return null;
            }
            var e = list[list.length - 1];
            if (e === endDom || _domUtilsDomBase2['default'].contains(e, endDom)) {
                list.splice(list.length - 1, 1);
                return {
                    dom: endDom,
                    offset: endOffset
                };
            }
            return null;
        }
    },
    /**
     * 获取 wiz 编辑操作中 已标注的 Img 父节点
     * @param dom
     * @returns {*}
     */
    getWizAmendImgParent: function getWizAmendImgParent(dom) {
        return _domUtilsDomBase2['default'].getParentByFilter(dom, function (node) {
            return node && node.nodeType === 1 && node.getAttribute(_commonConst2['default'].ATTR.IMG);
        }, true);
    },
    /**
     * 获取 wiz 编辑操作中 已标注为编辑的 父节点
     * @param dom
     * @returns {*}
     */
    getWizAmendParent: function getWizAmendParent(dom) {
        return _domUtilsDomBase2['default'].getParentByFilter(dom, function (node) {
            return node && node.nodeType === 1 && (node.getAttribute(_commonConst2['default'].ATTR.SPAN_INSERT) || node.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE));
        }, true);
    },
    /**
     * 获取 wiz 编辑操作中 已标注删除的 父节点
     * @param dom
     * @returns {*}
     */
    getWizDeleteParent: function getWizDeleteParent(dom) {
        return _domUtilsDomBase2['default'].getParentByFilter(dom, function (node) {
            return node && node.nodeType === 1 && node.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE);
        }, true);
    },
    /**
     * 获取 wiz 编辑操作中 已标注新增的 父节点
     * @param dom
     * @returns {*}
     */
    getWizInsertParent: function getWizInsertParent(dom) {
        return _domUtilsDomBase2['default'].getParentByFilter(dom, function (node) {
            //node.childNodes.length == 0 时，键盘敲入的字符加在 span 外面
            return node && node.nodeType === 1 && node.getAttribute(_commonConst2['default'].ATTR.SPAN_INSERT) && !node.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE) && node.childNodes.length > 0;
        }, true);
    },
    /**
     * 获取 鼠标选择范围内（Range）满足条件的 Wiz Span
     * @param isAll
     * @param options
     * @returns {*}
     */
    getWizSpanFromRange: function getWizSpanFromRange(isAll, options) {
        var exp = 'span',
            i,
            j,
            d;
        if (!options) {
            return [];
        }
        //根据 options 生成 dom 查询表达式
        for (i in options) {
            if (options.hasOwnProperty(i)) {
                if (options[i]) {
                    exp += '[' + i + '="' + options[i] + '"]';
                } else {
                    exp += '[' + i + ']';
                }
            }
        }

        var sel = _commonEnv2['default'].doc.getSelection(),
            range,
            startDom,
            startOffset,
            endDom,
            endOffset,
            startSpan,
            endSpan,
            parent,
            domList,
            startIndex,
            endIndex,
            dIdx,
            result = [];

        if (isAll) {
            //在 document.body 内进行查找
            var tmp = _commonEnv2['default'].doc.querySelectorAll(exp);
            for (i = 0, j = tmp.length; i < j; i++) {
                result.push(tmp[i]);
            }
            return result;
        }

        if (sel.rangeCount === 0) {
            return [];
        }

        if (sel.isCollapsed) {
            endDom = _rangeUtilsRangeBase2['default'].getRangeAnchor(false);
            startDom = _domUtilsDomBase2['default'].getPreviousNode(endDom, false, null);

            if (endDom) {
                endDom = _domUtilsDomBase2['default'].getParentByFilter(endDom, spanFilter, true);
                if (endDom) {
                    result.push(endDom);
                }
            }

            //TODO 对于换行的处理有问题，需要待定，暂时屏蔽
            //if (!endDom && startDom) {
            //    startDom = domUtils.getParentByFilter(startDom, spanFilter, true);
            //    if (startDom) {
            //        result.push(startDom);
            //    }
            //}

            return result;
        }
        startDom = _rangeUtilsRangeBase2['default'].getRangeAnchor(true);
        endDom = _rangeUtilsRangeBase2['default'].getRangeAnchor(false);

        if (!startDom || !endDom) {
            return [];
        }

        //获取 startDom, endDom 所在的 WizSpan 节点
        startSpan = _domUtilsDomBase2['default'].getParentByFilter(startDom, spanFilter, true);
        endSpan = _domUtilsDomBase2['default'].getParentByFilter(endDom, spanFilter, true);
        if (startSpan && startSpan == endSpan) {
            //startDom 和 endDom 所在同一个 WizSpan
            return [startSpan];
        }

        //在 startDom, endDom 共同的 parent 内根据查询表达式 查找 WizSpan
        parent = _domUtilsDomBase2['default'].getParentRoot([startDom, endDom]);
        domList = parent.querySelectorAll(exp);
        startIndex = _domUtilsDomBase2['default'].getIndexListByDom(startDom);
        endIndex = _domUtilsDomBase2['default'].getIndexListByDom(endDom);
        //startDom 是 TextNode 时，其父节点的 index 肯定要小于 startDom， 所以必须强行加入
        if (startSpan) {
            result.push(startSpan);
        }
        //根据 起始节点的 index 数据筛选 在其范围内的 WizSpan
        for (i = 0, j = domList.length; i < j; i++) {
            d = domList[i];
            dIdx = _domUtilsDomBase2['default'].getIndexListByDom(d);
            if (_domUtilsDomBase2['default'].compareIndexList(startIndex, dIdx) <= 0 && _domUtilsDomBase2['default'].compareIndexList(endIndex, dIdx) >= 0) {
                result.push(d);
            }
        }
        return result;

        /**
         * 查找 attribute 满足 options 的 Dom 节点过滤器
         * @param node
         * @returns {boolean}
         */
        function spanFilter(node) {
            if (!node || node.nodeType !== 1) {
                return false;
            }
            var i;
            for (i in options) {
                //option[i] == '' 表示 只看某属性是否存在，但不比较具体的value
                if (options.hasOwnProperty(i) && (!node.getAttribute(i) || options[i] && node.getAttribute(i) != options[i])) {
                    return false;
                }
            }
            return true;
        }
    },
    /**
     * 判断 是否为修订编辑的 笔记
     */
    isAmendEdited: function isAmendEdited() {
        var amendDoms = amendUtils.getAmendDoms({
            selection: true,
            selectAll: true
        });
        return !!amendDoms && (amendDoms.deleteList.length > 0 || amendDoms.insertList.length > 0 || amendDoms.deletedInsertList.length > 0);
    },
    /**
     * 判断 是否为 修订的 dom
     * @param dom
     * @returns {*|boolean}
     */
    isWizAmend: function isWizAmend(dom) {
        return amendUtils.getWizAmendParent(dom);
    },
    /**
     * 判断 是否为 删除内容
     * @param dom
     * @returns {boolean}
     */
    isWizDelete: function isWizDelete(dom) {
        return !!amendUtils.getWizDeleteParent(dom);
    },
    /**
     * 判断 是否为 新增内容
     * @param dom
     * @returns {boolean}
     */
    isWizInsert: function isWizInsert(dom) {
        return !!amendUtils.getWizInsertParent(dom);
    }
};

exports['default'] = amendUtils;
module.exports = exports['default'];

},{"../../common/const":13,"../../common/env":15,"../../common/utils":19,"../../domUtils/domBase":23,"../../rangeUtils/rangeBase":35,"./../amendUser":9}],11:[function(require,module,exports){
/**
 * amend 中通用的基本方法集合（扩展操作）
 *
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('../../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('../../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('../../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _domUtilsDomExtend = require('../../domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

var _rangeUtilsRangeExtend = require('../../rangeUtils/rangeExtend');

var _rangeUtilsRangeExtend2 = _interopRequireDefault(_rangeUtilsRangeExtend);

var _amendUser = require('./../amendUser');

var _amendUser2 = _interopRequireDefault(_amendUser);

var _amendBase = require('./amendBase');

var _amendBase2 = _interopRequireDefault(_amendBase);

/**
 * 添加 dom 到 getSelectedAmendDoms 或 getAmendDoms 方法得到的数据
 * @param amendDoms
 * @param dom
 */
_amendBase2['default'].add2SelectedAmendDoms = function (amendDoms, dom) {
    if (!dom) {
        return;
    }
    if (dom.getAttribute(_commonConst2['default'].ATTR.SPAN_INSERT) && dom.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE)) {
        amendDoms.deletedInsertList.push(dom);
    } else if (dom.getAttribute(_commonConst2['default'].ATTR.SPAN_INSERT)) {
        amendDoms.insertList.push(dom);
    } else if (dom.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE)) {
        amendDoms.deleteList.push(dom);
    }
};
/**
 * 创建用于 修订内容中 封装 img 的 span
 * @param type
 * @param user
 * @returns {HTMLElement}
 */
_amendBase2['default'].createDomForImg = function (type, user) {
    var tmp = _commonEnv2['default'].doc.createElement('span');
    _amendBase2['default'].setDefaultAttr(tmp, user);
    tmp.setAttribute(_commonConst2['default'].ATTR.IMG, '1');
    if (type == _commonConst2['default'].TYPE.IMG_DELETE) {
        tmp.removeAttribute(_commonConst2['default'].ATTR.SPAN_INSERT);
        tmp.setAttribute(_commonConst2['default'].ATTR.SPAN_DELETE, user.hash);
    }
    _amendBase2['default'].setUserImgContainerStyle(tmp);

    return tmp;
};
/**
 * 创建用于 新建内容的 span
 * @param user
 * @returns {HTMLElement}
 */
_amendBase2['default'].createDomForInsert = function (user) {
    var tmp = _commonEnv2['default'].doc.createElement('span');
    _amendBase2['default'].setDefaultAttr(tmp, user);
    _amendBase2['default'].setUserInsertStyle(tmp, user);
    tmp.innerHTML = _commonConst2['default'].FILL_CHAR;
    return tmp;
};
/**
 * 创建用于 反转修订时 新建内容的 span
 * @returns {HTMLElement}
 */
_amendBase2['default'].createDomForReverse = function () {
    var tmp = _commonEnv2['default'].doc.createElement('span');
    tmp.innerHTML = _commonConst2['default'].FILL_CHAR;
    return tmp;
};
/**
 * 创建 用于粘贴的 span
 * @param id
 * @param user
 * @returns {{start: HTMLElement, content: HTMLElement, end: HTMLElement}}
 */
_amendBase2['default'].createDomForPaste = function (id) {
    var start, content, end;
    start = _domUtilsDomExtend2['default'].createSpan();

    start.setAttribute(_commonConst2['default'].ATTR.SPAN_PASTE_TYPE, _commonConst2['default'].TYPE.PASTE.START);
    start.setAttribute(_commonConst2['default'].ATTR.SPAN_PASTE_ID, id);
    start.innerHTML = _commonConst2['default'].FILL_CHAR;

    content = _domUtilsDomExtend2['default'].createSpan();
    content.setAttribute(_commonConst2['default'].ATTR.SPAN_PASTE_TYPE, _commonConst2['default'].TYPE.PASTE.CONTENT);
    content.setAttribute(_commonConst2['default'].ATTR.SPAN_PASTE_ID, id);
    content.innerHTML = _commonConst2['default'].FILL_CHAR + _commonConst2['default'].FILL_CHAR;

    end = _domUtilsDomExtend2['default'].createSpan();
    end.setAttribute(_commonConst2['default'].ATTR.SPAN_PASTE_TYPE, _commonConst2['default'].TYPE.PASTE.END);
    end.setAttribute(_commonConst2['default'].ATTR.SPAN_PASTE_ID, id);
    end.innerHTML = _commonConst2['default'].FILL_CHAR;
    return {
        start: start,
        content: content,
        end: end
    };
};
/**
 * 标记 删除的 img
 * @param img
 * @param user
 */
_amendBase2['default'].deleteImg = function (img, user) {
    //必须首先判断 img 是否为已已标记修订的 img span 内
    var imgSpan = _amendBase2['default'].getWizAmendImgParent(img),
        mask;
    if (imgSpan) {
        //如果是已删除的， 则直接忽略
        //如果不是，则直接给 img span 添加 删除标识
        if (!imgSpan.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE)) {
            imgSpan.setAttribute(_commonConst2['default'].ATTR.SPAN_USERID, user.hash);
            imgSpan.setAttribute(_commonConst2['default'].ATTR.SPAN_DELETE, user.hash);
            mask = imgSpan.querySelector('img[' + _commonConst2['default'].ATTR.IMG_MASK + ']');
            _domUtilsDomExtend2['default'].css(mask, _commonConst2['default'].CSS.IMG.MASK, false);
            _domUtilsDomExtend2['default'].css(mask, _commonConst2['default'].CSS.IMG_DELETED, false);
        }
        return;
    }

    //因为 删除img 时，是在 img 外面封装span ，破坏了 range 的范围，
    // 所以如果 img 是在 range 的边缘时必须要修正
    var rangeEdge = _rangeUtilsRangeExtend2['default'].isRangeEdge(img);

    var nSpan = _amendBase2['default'].packageImg(img, _commonConst2['default'].TYPE.IMG_DELETE, user);

    if (rangeEdge.isStart) {
        rangeEdge.startDom = nSpan;
        rangeEdge.startOffset = 0;
    }
    if (rangeEdge.isEnd) {
        rangeEdge.endDom = nSpan.parentNode;
        rangeEdge.endOffset = _domUtilsDomExtend2['default'].getDomIndex(nSpan) + 1;
    }

    if (rangeEdge.isCollapsed && rangeEdge.isStart) {
        _rangeUtilsRangeExtend2['default'].setRange(rangeEdge.startDom, _domUtilsDomExtend2['default'].getDomEndOffset(rangeEdge.startDom), null, null);
    } else if (!rangeEdge.isCollapsed && (rangeEdge.isStart || rangeEdge.isEnd)) {
        _rangeUtilsRangeExtend2['default'].setRange(rangeEdge.startDom, rangeEdge.startOffset, rangeEdge.endDom, rangeEdge.endOffset);
    }
};
/**
 * 修正 删除图片操作后的 光标位置（用于修订）
 */
_amendBase2['default'].fixSelectionByDeleteImg = function () {
    var sel = _commonEnv2['default'].doc.getSelection(),
        range = sel.getRangeAt(0),
        startDom,
        endDom,
        startOffset,
        endOffset,
        isDeleteImgStart = false,
        isDeleteImgEnd = false;

    if (sel.rangeCount === 0) {
        return;
    }

    //判断 startDom 是否处于已删除的 img span 内
    startDom = _amendBase2['default'].getWizAmendImgParent(range.startContainer);
    if (startDom && !startDom.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE)) {
        startDom = null;
    }
    if (!startDom) {
        startDom = range.startContainer;
        startOffset = range.startOffset;
    } else {
        isDeleteImgStart = true;
        startOffset = 0;
    }

    if (!sel.isCollapsed) {
        endDom = _amendBase2['default'].getWizAmendImgParent(range.endContainer);
        if (!endDom) {
            endDom = range.endContainer;
            endOffset = range.endOffset;
        } else {
            isDeleteImgEnd = true;
        }
    } else {
        endDom = startDom;
        isDeleteImgEnd = isDeleteImgStart;
    }

    if (isDeleteImgEnd && endDom && endDom.nextSibling) {
        endOffset = 0;
        endDom = endDom.nextSibling;
    } else if (isDeleteImgEnd && endDom) {
        endOffset = _domUtilsDomExtend2['default'].getDomIndex(endDom) + 1;
        endDom = endDom.parentNode;
    } else {
        endOffset = range.endOffset;
    }

    if (sel.isCollapsed) {
        sel.collapse(endDom, endOffset);
    } else {
        sel.collapse(startDom, startOffset);
        sel.extend(endDom, endOffset);
    }
};
/**
 * 粘贴后，修改新粘贴的内容样式（设置为当前用户新建内容）
 * @param nSpanStart
 * @param nSpanEnd
 * @param user
 */
_amendBase2['default'].modifyDomForPaste = function (nSpanStart, nSpanEnd, user) {
    if (!nSpanStart || !nSpanEnd) {
        return;
    }

    if (nSpanStart.childNodes.length === 1 && nSpanStart.innerText == _commonConst2['default'].FILL_CHAR) {
        nSpanStart.innerHTML = '';
    }
    if (nSpanEnd.childNodes.length === 1 && nSpanEnd.innerText == _commonConst2['default'].FILL_CHAR) {
        nSpanEnd.innerHTML = '';
    }

    var parent = _domUtilsDomExtend2['default'].getParentRoot([nSpanStart, nSpanEnd]);
    if (!parent) {
        return;
    }

    var tmpP, tmpD, tmpWizAmend, i, j, d, domResult, domList;

    domResult = _domUtilsDomExtend2['default'].getDomListA2B({
        startDom: nSpanStart,
        startOffset: 0,
        endDom: nSpanEnd,
        endOffset: _domUtilsDomExtend2['default'].getDomEndOffset(nSpanEnd)
    });
    domList = domResult.list;
    for (i = 0, j = domList.length; i < j; i++) {
        d = domList[i];
        tmpP = d.parentNode;
        tmpWizAmend = _amendBase2['default'].getWizAmendParent(d);
        if (!tmpP) {
            continue;
        }
        if (tmpWizAmend) {
            //如果是复制的 修订span ，则直接修改 span 为当前粘贴的用户
            d = tmpWizAmend;
        } else if (d.nodeType == 3) {
            if (_commonUtils2['default'].isEmpty(d.nodeValue)) {
                continue;
            }
            //粘贴操作后， 如果 PASTE_TYPE = CONTENT 的 span 内有 nodeType != 3 的节点，则不能直接修改 CONTENT 这个 span
            if (_domUtilsDomExtend2['default'].isWizSpan(tmpP) && tmpP.children.length === 0) {
                d = tmpP;
            } else {
                tmpD = _amendBase2['default'].createDomForInsert(user);
                tmpD.innerHTML = '';
                tmpP.insertBefore(tmpD, d);
                tmpD.appendChild(d);
                d = tmpD;
            }
        }

        if (_domUtilsDomExtend2['default'].isTag(d, 'img')) {
            d = _amendBase2['default'].packageImg(d, _commonConst2['default'].TYPE.IMG_INSERT, user);
        } else if (_domUtilsDomExtend2['default'].isSelfClosingTag(d)) {
            continue;
        }
        _amendBase2['default'].setDefaultAttr(d, user);
        _amendBase2['default'].setUserInsertStyle(d, user);
    }

    //清理空的临时 span
    if (parent != _commonEnv2['default'].doc.body && parent != _commonEnv2['default'].doc.body.parentNode && parent.parentNode) {
        parent = parent.parentNode;
    }
    domList = parent.querySelectorAll('span[' + _commonConst2['default'].ATTR.SPAN_PASTE_TYPE + ']');
    for (i = 0, j = domList.length; i < j; i++) {
        d = domList[i];
        if (d.childNodes.length === 0) {
            d.parentNode.removeChild(d);
        } else {
            d.removeAttribute(_commonConst2['default'].ATTR.SPAN_PASTE_TYPE);
            d.removeAttribute(_commonConst2['default'].ATTR.SPAN_PASTE_ID);
        }
    }
};
/**
 * 封装修订中的 img（用于删除、粘贴的图片）
 * @param img
 * @param type
 * @param user
 * @returns {HTMLElement}
 */
_amendBase2['default'].packageImg = function (img, type, user) {
    //添加元素的顺序不要随便改动， 会影响 selection 光标的位置
    var pNode,
        nextNode,
        tmpNode,
        nSpan = _amendBase2['default'].createDomForImg(type, user);
    pNode = img.parentNode;
    nextNode = img.nextSibling;
    while (nextNode && nextNode.nodeType == 3 && nextNode.nodeValue == _commonConst2['default'].FILL_CHAR) {
        tmpNode = nextNode;
        nextNode = nextNode.nextSibiling;
        tmpNode.parentNode.removeChild(tmpNode);
    }
    nSpan.appendChild(img);
    //添加遮罩
    var mask = _commonEnv2['default'].doc.createElement('img');
    mask.className += _commonConst2['default'].CLASS.IMG_NOT_DRAG;
    mask.setAttribute(_commonConst2['default'].ATTR.IMG_MASK, '1');
    //手机客户端有的情况下会设置 img max-width = 80%
    if (img.style.maxWidth) {
        mask.style.maxWidth = img.style.maxWidth;
    }
    if (img.style.maxHeight) {
        mask.style.maxHeight = img.style.maxHeight;
    }
    if (img.style.width) {
        mask.style.width = img.style.width;
    }
    if (img.style.height) {
        mask.style.height = img.style.height;
    }
    _domUtilsDomExtend2['default'].css(mask, _commonConst2['default'].CSS.IMG.MASK, false);
    if (type == _commonConst2['default'].TYPE.IMG_DELETE) {
        _domUtilsDomExtend2['default'].css(mask, _commonConst2['default'].CSS.IMG_DELETED, false);
    } else {
        _domUtilsDomExtend2['default'].css(mask, _commonConst2['default'].CSS.IMG_INSERT, false);
    }
    nSpan.appendChild(mask);
    pNode.insertBefore(nSpan, nextNode);
    return nSpan;
};
/**
 * 删除 有当前用户删除标记的内容
 * @param parentRoot
 * @param user
 */
_amendBase2['default'].removeUserDel = function (parentRoot, user) {
    var deleteDomList = [],
        i,
        j,
        dom,
        p;
    if (!parentRoot) {
        parentRoot = _rangeUtilsRangeExtend2['default'].getRangeParentRoot();
    }
    if (parentRoot) {
        if (!_domUtilsDomExtend2['default'].isBody(parentRoot)) {
            //避免直接返回最底层的 span，从而导致查询失败，所以需要扩大范围
            parentRoot = parentRoot.parentNode;
        }
        //判断当前的 元素是否是在 已封包的 修订 img 中
        dom = _amendBase2['default'].getWizAmendImgParent(parentRoot);

        //只获取当前用户修订的 img span
        if (dom && dom.getAttribute(_commonConst2['default'].ATTR.SPAN_USERID) !== user.hash) {
            dom = null;
        }

        if (dom) {
            // 针对 img 特殊处理
            deleteDomList.push(dom);
        } else {
            _domUtilsDomExtend2['default'].search(parentRoot, '[' + _commonConst2['default'].ATTR.SPAN_INSERT + '="' + user.hash + '"][' + _commonConst2['default'].ATTR.SPAN_DELETE + '="' + user.hash + '"]', deleteDomList);

            //TODO 此种情况可能已经不会存在了
            _domUtilsDomExtend2['default'].search(parentRoot, '[' + _commonConst2['default'].ATTR.SPAN_USERID + '="' + user.hash + '"] [' + _commonConst2['default'].ATTR.SPAN_DELETE + '="' + user.hash + '"]', deleteDomList);
        }
    }

    for (i = 0, j = deleteDomList.length; i < j; i++) {
        dom = deleteDomList[i];
        p = dom.parentNode;
        p.removeChild(dom);
        _domUtilsDomExtend2['default'].removeEmptyParent(p);
    }
};
/**
 * 根据 user 获取删除操作时，需要设置的 style & attr
 * @param user
 * @returns {{attr: {}, style: {color: *, text-decoration: string}}}
 */
_amendBase2['default'].getDeletedStyle = function (user) {
    var attr = {};
    attr[_commonConst2['default'].ATTR.SPAN_DELETE] = user.hash;
    attr[_commonConst2['default'].ATTR.SPAN_USERID] = user.hash;
    attr[_commonConst2['default'].ATTR.SPAN_TIMESTAMP] = _commonUtils2['default'].getTime();

    var style = { 'color': user.color, 'text-decoration': 'line-through' };

    return {
        attr: attr,
        style: style
    };
};
/**
 * 对光标选择范围设置 当前用户的 删除标记
 * @param user
 */
_amendBase2['default'].removeSelection = function (user) {
    var sel = _commonEnv2['default'].doc.getSelection(),
        range = sel.getRangeAt(0),
        startDom = range.startContainer,
        startOffset = range.startOffset,
        endDom = range.endContainer,
        endOffset = range.endOffset,
        startImg = _amendBase2['default'].getWizAmendImgParent(startDom),
        endImg = _amendBase2['default'].getWizAmendImgParent(endDom),
        splitInsert;

    //如果开始 或结尾 是 修订的内容，但不是 img 的时候， 需要进行拆分后处理
    if (!endImg) {
        splitInsert = _amendBase2['default'].splitInsertDom(endDom, endOffset, true, user);
        if (splitInsert.isInsert && splitInsert.split) {
            _rangeUtilsRangeExtend2['default'].setRange(startDom, startOffset, endDom, endOffset);
        }
    }
    if (!startImg) {
        splitInsert = _amendBase2['default'].splitInsertDom(startDom, startOffset, true, user);
        if (splitInsert.isInsert && splitInsert.split) {
            //如果 选中的是 某一个dom 的中间部分
            if (endDom === startDom) {
                endDom = splitInsert.insertDom.nextSibling;
                endOffset = endDom.childNodes.length;
            }
            startDom = splitInsert.insertDom;
            startOffset = splitInsert.insertDom.childNodes.length;
            _rangeUtilsRangeExtend2['default'].setRange(startDom, startOffset, endDom, endOffset);
        }
    }

    if (sel.isCollapsed) {
        //如果扩展范围后，依然为 折叠状态， 不进行任何删除样式的修改
        return;
    }

    var style = _amendBase2['default'].getDeletedStyle(user);
    _rangeUtilsRangeExtend2['default'].modifySelectionDom(style.style, style.attr);
    _amendBase2['default'].fixSelectionByDeleteImg();
};
/**
 * 初始化 新增span 的属性
 * @param dom
 * @param user
 */
_amendBase2['default'].setDefaultAttr = function (dom, user) {
    if (dom.nodeType == 1) {
        dom.setAttribute(_commonConst2['default'].ATTR.SPAN, _commonConst2['default'].ATTR.SPAN);
        dom.setAttribute(_commonConst2['default'].ATTR.SPAN_INSERT, user.hash);
        dom.setAttribute(_commonConst2['default'].ATTR.SPAN_USERID, user.hash);
        dom.setAttribute(_commonConst2['default'].ATTR.SPAN_TIMESTAMP, _commonUtils2['default'].getTime());
    }
};
/**
 * 初始化已删除图片外层 span 的修订样式
 * @param dom
 */
_amendBase2['default'].setUserImgContainerStyle = function (dom) {
    _domUtilsDomExtend2['default'].css(dom, _commonConst2['default'].CSS.IMG.SPAN, false);
};
/**
 * 初始化用户修订样式
 * @param dom
 * @param user
 */
_amendBase2['default'].setUserInsertStyle = function (dom, user) {
    _domUtilsDomExtend2['default'].css(dom, {
        'color': user.color,
        'text-decoration': 'underline'
    }, false);
};

/**
 * 根据 修订Dom 处理 Range 范围 （主要是 img 处于 Range 边缘时）
 * @returns {{startImg: *, endImg: *, startDom: Node, startOffset: Number, endDom: Node, endOffset: Number, leftDom: *, rightDom: *}}
 */
_amendBase2['default'].fixedAmendRange = function () {
    var sel = _commonEnv2['default'].doc.getSelection(),
        range = sel.getRangeAt(0),
        startDom = range.startContainer,
        endDom = range.endContainer,
        startOffset = range.startOffset,
        endOffset = range.endOffset;

    //判断光标范围， 光标编辑区边界如果是 修订的 img 必须要把 img 全部选中
    var leftDom, rightDom, startInnerDom, endInnerDom, startImg, endImg;
    if (sel.isCollapsed) {
        rightDom = _rangeUtilsRangeExtend2['default'].getRangeAnchor(false);
        //如果光标在某个 textNode 中间， 则前后都是当前这个 textNode
        if (endDom.nodeType === 3 && endOffset > 0 && endOffset < endDom.nodeValue.length) {
            leftDom = rightDom;
        } else {
            leftDom = _domUtilsDomExtend2['default'].getPreviousNode(rightDom, false, null);
        }
    } else {
        startInnerDom = _rangeUtilsRangeExtend2['default'].getRangeAnchor(true);
        endInnerDom = _rangeUtilsRangeExtend2['default'].getRangeAnchor(false);
        startImg = _amendBase2['default'].getWizAmendImgParent(startInnerDom);
        endImg = _amendBase2['default'].getWizAmendImgParent(endInnerDom);

        if (startImg) {
            startDom = startImg;
            startOffset = 0;
        }
        if (endImg) {
            endDom = endImg;
            endOffset = endImg.childNodes.length;
        }
        if (startImg || endImg) {
            _rangeUtilsRangeExtend2['default'].setRange(startDom, startOffset, endDom, endOffset);
        }
    }

    return {
        startImg: startImg,
        endImg: endImg,
        startDom: startDom,
        startOffset: startOffset,
        endDom: endDom,
        endOffset: endOffset,
        leftDom: leftDom,
        rightDom: rightDom
    };
};
/**
 * 根据 range 拆分 amend span （主要用于 普通编辑 & 在 amend span 内添加其他 html）
 * @param  fixed (amendUtils.fixedAmendRange 方法的返回值)
 */
_amendBase2['default'].splitAmendDomByRange = function (fixed) {
    var sel = _commonEnv2['default'].doc.getSelection(),
        range,
        startDom = fixed.startContainer,
        endDom = fixed.endContainer,
        startOffset = fixed.startOffset,
        endOffset = fixed.endOffset,
        startImg,
        endImg;

    if (!sel.isCollapsed) {
        sel.deleteFromDocument();
        range = sel.getRangeAt(0);
        endDom = range.endContainer;
        endOffset = range.endOffset;
    } else {
        startImg = _amendBase2['default'].getWizAmendImgParent(fixed.leftDom);
        endImg = _amendBase2['default'].getWizAmendImgParent(fixed.rightDom);
        if (endImg) {
            endDom = endImg;
            endOffset = 0;
            _rangeUtilsRangeExtend2['default'].setRange(endDom, endOffset, endDom, endOffset);
        } else if (startImg) {
            startDom = startImg;
            startOffset = startImg.childNodes.length;
            _rangeUtilsRangeExtend2['default'].setRange(startDom, startOffset, startDom, startOffset);
        }

        range = sel.getRangeAt(0);
        endDom = range.endContainer;
        endOffset = range.endOffset;
    }

    var newDom = _amendBase2['default'].splitAmendDomForReverse(endDom, endOffset);
    if (newDom) {
        _rangeUtilsRangeExtend2['default'].setRange(newDom, 1, newDom, 1);
        return newDom;
    }
    return null;
};
/**
 * 如果在 已删除的文字内，需要筛分 已删除Dom，在中间添加
 * @param endDom
 * @param endOffset
 * @returns {boolean}
 */
_amendBase2['default'].splitDeletedDom = function (endDom, endOffset) {
    if (endDom.nodeType == 1) {
        return false;
    }
    var splitDom = null;
    if (_amendBase2['default'].isWizDelete(endDom)) {
        splitDom = _amendBase2['default'].splitWizDomWithTextNode(endDom, endOffset);
        return !!splitDom;
    }
    return false;
};
/**
 * 如果在 wiz span 内，进行操作时 需要拆分 Dom，在中间添加
 * @param endDom
 * @param endOffset
 * @param forceSplit
 * @param user
 * @returns {{}}
 */
_amendBase2['default'].splitInsertDom = function (endDom, endOffset, forceSplit, user) {
    var result = {
        insertDom: null,
        isInsert: false,
        split: false
    };
    if (!endDom) {
        return result;
    }
    if (endDom.nodeType == 1 && endOffset > 0) {
        endDom = endDom.childNodes[endOffset - 1];
        endOffset = _domUtilsDomExtend2['default'].getDomEndOffset(endDom);
    } else if (endDom.nodeType == 1) {
        endDom = endDom.childNodes[0];
    }
    if (!endDom) {
        return result;
    }
    var imgDom = _amendBase2['default'].getWizAmendImgParent(endDom),
        insertDom = _amendBase2['default'].getWizInsertParent(endDom),
        time1,
        time2;
    result.insertDom = insertDom;
    if (!insertDom && endDom.nodeType == 1) {
        return result;
    }
    if (imgDom) {
        return result;
    }

    if (insertDom && (forceSplit || insertDom.getAttribute(_commonConst2['default'].ATTR.SPAN_USERID) !== user.hash)) {
        //强迫分割（粘贴操作、Enter）时，直接分隔，不考虑时间
        result.split = true;
    } else if (insertDom) {
        //对于同一个用户，新增内容的在 AMEND_TIME_SPACE 时间间隔内，则仅更新时间戳，否则拆分 span
        time1 = insertDom.getAttribute(_commonConst2['default'].ATTR.SPAN_TIMESTAMP);
        time2 = _commonUtils2['default'].getTime();
        if (_commonUtils2['default'].getDateForTimeStr(time2) - _commonUtils2['default'].getDateForTimeStr(time1) >= _commonConst2['default'].AMEND_TIME_SPACE) {
            result.split = true;
        } else {
            insertDom.setAttribute(_commonConst2['default'].ATTR.SPAN_TIMESTAMP, time2);
        }
    }

    if (result.split) {
        result.split = !!_amendBase2['default'].splitWizDomWithTextNode(endDom, endOffset);
    }

    result.isInsert = !!insertDom;
    return result;
};
/**
 * 如果在 已修订的span 内，进行操作时 需要拆分 Dom，避免修订样式被继承（专门用于 逆修订）
 * @param endDom
 * @param endOffset
 * @returns {}
 */
_amendBase2['default'].splitAmendDomForReverse = function (endDom, endOffset) {
    var imgDom = _amendBase2['default'].getWizAmendImgParent(endDom);

    if (!imgDom && endDom.nodeType == 1 && endOffset > 0) {
        endDom = endDom.childNodes[endOffset - 1];
        endOffset = _domUtilsDomExtend2['default'].getDomEndOffset(endDom);
    } else if (!imgDom && endDom.nodeType == 1) {
        endDom = endDom.childNodes[0];
    }
    if (!endDom) {
        return null;
    }
    var insertDom = _amendBase2['default'].getWizInsertParent(endDom),
        deleteDom = _amendBase2['default'].getWizDeleteParent(endDom),
        amendDom = insertDom || deleteDom,
        newDom = _amendBase2['default'].createDomForReverse();

    if (imgDom) {
        _domUtilsDomExtend2['default'].before(imgDom, newDom, endOffset > 0);
    } else if (amendDom) {
        amendDom = _amendBase2['default'].splitWizDomWithTextNode(endDom, endOffset);
        if (amendDom) {
            _domUtilsDomExtend2['default'].before(amendDom, newDom, true);
        } else {
            return null;
        }
    } else {
        return null;
    }

    return newDom;
};
/**
 * 把 根据 getSelectedAmendDoms 或 getAmendDoms 方法得到的数据中 起始、结束位置的 dom 进行拆分， 实现选择范围内 接受、拒绝修订
 * @param amendDoms
 */
_amendBase2['default'].splitSelectedAmendDoms = function (amendDoms) {
    if (!amendDoms || !amendDoms.start && !amendDoms.end) {
        return;
    }

    var sel = _commonEnv2['default'].doc.getSelection(),
        range = sel.getRangeAt(0),
        startDom = range.startContainer,
        startOffset = range.startOffset,
        endDom = range.endContainer,
        endOffset = range.endOffset;

    var node;

    if (amendDoms.start && amendDoms.end && amendDoms.start.dom == amendDoms.end.dom) {
        //选择范围在 一个 dom 内部的时候，会把一个 dom 拆分为 3 段
        //为保证主 dom 不丢失，所以一定要先 end 后 start
        _amendBase2['default'].splitWizDomWithTextNode(amendDoms.end.dom, amendDoms.end.offset);
        node = _amendBase2['default'].splitWizDomWithTextNode(amendDoms.start.dom, amendDoms.start.offset);
        node = node.nextSibling;
        _amendBase2['default'].add2SelectedAmendDoms(amendDoms, node);
        startDom = node;
        startOffset = 0;
        endDom = node;
        endOffset = node.childNodes.length;
    } else {
        //单独拆分 选择范围的起始dom 和 结束dom
        if (amendDoms.start) {
            node = _amendBase2['default'].splitWizDomWithTextNode(amendDoms.start.dom, amendDoms.start.offset);
            node = node.nextSibling;
            _amendBase2['default'].add2SelectedAmendDoms(amendDoms, node);
            startDom = node;
            startOffset = 0;
        }
        if (amendDoms.end) {
            node = _amendBase2['default'].splitWizDomWithTextNode(amendDoms.end.dom, amendDoms.end.offset);
            _amendBase2['default'].add2SelectedAmendDoms(amendDoms, node);
            endDom = node;
            endOffset = node.childNodes.length;
        }
    }
    delete amendDoms.start;
    delete amendDoms.end;
    //修正选择范围
    _rangeUtilsRangeExtend2['default'].setRange(startDom, startOffset, endDom, endOffset);
};
/**
 * 从 TextNode 的 光标位置 拆分该 TextNode 的 修订 Dom
 * @param endDom
 * @param endOffset
 * @returns {*}  //返回最后拆分的 Dom
 */
_amendBase2['default'].splitWizDomWithTextNode = function (endDom, endOffset) {
    if (!endDom || endDom.nodeType !== 3) {
        return null;
    }
    var tmpSplitStr,
        tmpSplit,
        tmpParent,
        tmpDom,
        lastSplit = null;
    if (endOffset < endDom.nodeValue.length) {
        tmpSplitStr = endDom.nodeValue.substr(endOffset);
        tmpSplit = endDom.cloneNode(false);
        tmpSplit.nodeValue = tmpSplitStr;
        endDom.nodeValue = endDom.nodeValue.substr(0, endOffset);
        endDom.parentNode.insertBefore(tmpSplit, endDom.nextSibling);
        lastSplit = endDom;
        tmpParent = endDom.parentNode;
        tmpDom = tmpSplit;
    } else {
        tmpParent = endDom.parentNode;
        tmpDom = endDom.nextSibling;
    }
    while (!!tmpParent && !_domUtilsDomExtend2['default'].isBody(tmpParent)) {
        lastSplit = tmpParent;
        _domUtilsDomExtend2['default'].splitDom(tmpParent, tmpDom);
        if (tmpParent && tmpParent.nodeType === 1 && (tmpParent.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE) || tmpParent.getAttribute(_commonConst2['default'].ATTR.SPAN_INSERT))) {
            break;
        }
        tmpDom = tmpParent.nextSibling;
        tmpParent = tmpParent.parentNode;
    }
    return lastSplit;
};
/**
 * 删除 修订内容（接受 已删除的； 拒绝已添加的）
 * @param domList
 */
_amendBase2['default'].wizAmendDelete = function (domList) {
    var i, j, d, p;
    for (i = 0, j = domList.length; i < j; i++) {
        d = domList[i];
        p = d.parentNode;
        p.removeChild(d);
        _domUtilsDomExtend2['default'].removeEmptyParent(p);
    }
};
/**
 * 保留 修订内容（接受 已添加的； 拒绝已删除的）
 * @param domList
 */
_amendBase2['default'].wizAmendSave = function (domList) {
    var i, j, d, u;
    for (i = 0, j = domList.length; i < j; i++) {
        d = domList[i];

        if (d.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE) && d.getAttribute(_commonConst2['default'].ATTR.SPAN_INSERT) && d.getAttribute(_commonConst2['default'].ATTR.SPAN_INSERT) !== d.getAttribute(_commonConst2['default'].ATTR.SPAN_USERID)) {
            //如果 是用户B 删除了 用户A 新增的内容， 则拒绝已删除操作时，恢复为用户A 新增的状态
            u = _amendUser2['default'].getUserByGuid(d.getAttribute(_commonConst2['default'].ATTR.SPAN_INSERT));
            u = u ? u : {};
            d.removeAttribute(_commonConst2['default'].ATTR.SPAN_DELETE);
            d.setAttribute(_commonConst2['default'].ATTR.SPAN_USERID, u.hash);

            if (d.getAttribute(_commonConst2['default'].ATTR.IMG)) {
                _amendBase2['default'].setUserImgContainerStyle(d);
                _domUtilsDomExtend2['default'].css(mask, _commonConst2['default'].CSS.IMG_INSERT, false);
            } else {
                _amendBase2['default'].setUserInsertStyle(d, u);
            }
            continue;
        }

        if (d.getAttribute(_commonConst2['default'].ATTR.IMG)) {
            _domUtilsDomExtend2['default'].before(d, d.children[0], false);
            d.parentNode.removeChild(d);
        } else {
            _domUtilsDomExtend2['default'].css(d, {
                'color': '',
                'text-decoration': ''
            }, false);
            //                    d.removeAttribute(CONST.ATTR.SPAN);
            d.removeAttribute(_commonConst2['default'].ATTR.SPAN_USERID);
            d.removeAttribute(_commonConst2['default'].ATTR.SPAN_INSERT);
            d.removeAttribute(_commonConst2['default'].ATTR.SPAN_DELETE);
            d.removeAttribute(_commonConst2['default'].ATTR.SPAN_PASTE);
            d.removeAttribute(_commonConst2['default'].ATTR.SPAN_PASTE_TYPE);
            d.removeAttribute(_commonConst2['default'].ATTR.SPAN_PASTE_ID);
            d.removeAttribute(_commonConst2['default'].ATTR.SPAN_TIMESTAMP);
        }
    }
};

exports['default'] = _amendBase2['default'];
module.exports = exports['default'];

},{"../../common/const":13,"../../common/env":15,"../../common/utils":19,"../../domUtils/domExtend":24,"../../rangeUtils/rangeExtend":36,"./../amendUser":9,"./amendBase":10}],12:[function(require,module,exports){
/*
 * $Id: base64.js,v 2.15 2014/04/05 12:58:57 dankogai Exp dankogai $
 *  https://github.com/dankogai/js-base64
 *  Licensed under the MIT license.
 *    http://opensource.org/licenses/mit-license
 *
 *  References:
 *    http://en.wikipedia.org/wiki/Base64
 */

'use strict';
Object.defineProperty(exports, '__esModule', {
    value: true
});
var global = {};
// existing version for noConflict()
var _Base64 = global.Base64;
var version = "2.1.8";
// if node.js, we use Buffer
var buffer;
if (typeof module !== 'undefined' && module.exports) {
    buffer = require('buffer').Buffer;
}
// constants
var b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
var b64tab = (function (bin) {
    var t = {};
    for (var i = 0, l = bin.length; i < l; i++) t[bin.charAt(i)] = i;
    return t;
})(b64chars);
var fromCharCode = String.fromCharCode;
// encoder stuff
var cb_utob = function cb_utob(c) {
    if (c.length < 2) {
        var cc = c.charCodeAt(0);
        return cc < 0x80 ? c : cc < 0x800 ? fromCharCode(0xc0 | cc >>> 6) + fromCharCode(0x80 | cc & 0x3f) : fromCharCode(0xe0 | cc >>> 12 & 0x0f) + fromCharCode(0x80 | cc >>> 6 & 0x3f) + fromCharCode(0x80 | cc & 0x3f);
    } else {
        var cc = 0x10000 + (c.charCodeAt(0) - 0xD800) * 0x400 + (c.charCodeAt(1) - 0xDC00);
        return fromCharCode(0xf0 | cc >>> 18 & 0x07) + fromCharCode(0x80 | cc >>> 12 & 0x3f) + fromCharCode(0x80 | cc >>> 6 & 0x3f) + fromCharCode(0x80 | cc & 0x3f);
    }
};
var re_utob = /[\uD800-\uDBFF][\uDC00-\uDFFFF]|[^\x00-\x7F]/g;
var utob = function utob(u) {
    return u.replace(re_utob, cb_utob);
};
var cb_encode = function cb_encode(ccc) {
    var padlen = [0, 2, 1][ccc.length % 3],
        ord = ccc.charCodeAt(0) << 16 | (ccc.length > 1 ? ccc.charCodeAt(1) : 0) << 8 | (ccc.length > 2 ? ccc.charCodeAt(2) : 0),
        chars = [b64chars.charAt(ord >>> 18), b64chars.charAt(ord >>> 12 & 63), padlen >= 2 ? '=' : b64chars.charAt(ord >>> 6 & 63), padlen >= 1 ? '=' : b64chars.charAt(ord & 63)];
    return chars.join('');
};
var btoa = global.btoa ? function (b) {
    return global.btoa(b);
} : function (b) {
    return b.replace(/[\s\S]{1,3}/g, cb_encode);
};
var _encode = buffer ? function (u) {
    return (u.constructor === buffer.constructor ? u : new buffer(u)).toString('base64');
} : function (u) {
    return btoa(utob(u));
};
var encode = function encode(u, urisafe) {
    return !urisafe ? _encode(String(u)) : _encode(String(u)).replace(/[+\/]/g, function (m0) {
        return m0 == '+' ? '-' : '_';
    }).replace(/=/g, '');
};
var encodeURI = function encodeURI(u) {
    return encode(u, true);
};
// decoder stuff
var re_btou = new RegExp(['[\xC0-\xDF][\x80-\xBF]', '[\xE0-\xEF][\x80-\xBF]{2}', '[\xF0-\xF7][\x80-\xBF]{3}'].join('|'), 'g');
var cb_btou = function cb_btou(cccc) {
    switch (cccc.length) {
        case 4:
            var cp = (0x07 & cccc.charCodeAt(0)) << 18 | (0x3f & cccc.charCodeAt(1)) << 12 | (0x3f & cccc.charCodeAt(2)) << 6 | 0x3f & cccc.charCodeAt(3),
                offset = cp - 0x10000;
            return fromCharCode((offset >>> 10) + 0xD800) + fromCharCode((offset & 0x3FF) + 0xDC00);
        case 3:
            return fromCharCode((0x0f & cccc.charCodeAt(0)) << 12 | (0x3f & cccc.charCodeAt(1)) << 6 | 0x3f & cccc.charCodeAt(2));
        default:
            return fromCharCode((0x1f & cccc.charCodeAt(0)) << 6 | 0x3f & cccc.charCodeAt(1));
    }
};
var btou = function btou(b) {
    return b.replace(re_btou, cb_btou);
};
var cb_decode = function cb_decode(cccc) {
    var len = cccc.length,
        padlen = len % 4,
        n = (len > 0 ? b64tab[cccc.charAt(0)] << 18 : 0) | (len > 1 ? b64tab[cccc.charAt(1)] << 12 : 0) | (len > 2 ? b64tab[cccc.charAt(2)] << 6 : 0) | (len > 3 ? b64tab[cccc.charAt(3)] : 0),
        chars = [fromCharCode(n >>> 16), fromCharCode(n >>> 8 & 0xff), fromCharCode(n & 0xff)];
    chars.length -= [0, 0, 2, 1][padlen];
    return chars.join('');
};
var atob = global.atob ? function (a) {
    return global.atob(a);
} : function (a) {
    return a.replace(/[\s\S]{1,4}/g, cb_decode);
};
var _decode = buffer ? function (a) {
    return (a.constructor === buffer.constructor ? a : new buffer(a, 'base64')).toString();
} : function (a) {
    return btou(atob(a));
};
var decode = function decode(a) {
    return _decode(String(a).replace(/[-_]/g, function (m0) {
        return m0 == '-' ? '+' : '/';
    }).replace(/[^A-Za-z0-9\+\/]/g, ''));
};
var noConflict = function noConflict() {
    var Base64 = global.Base64;
    global.Base64 = _Base64;
    return Base64;
};
// export Base64
global.Base64 = {
    VERSION: version,
    atob: atob,
    btoa: btoa,
    fromBase64: decode,
    toBase64: encode,
    utob: utob,
    encode: encode,
    encodeURI: encodeURI,
    btou: btou,
    decode: decode,
    noConflict: noConflict
};
// if ES5 is available, make Base64.extendString() available
if (typeof Object.defineProperty === 'function') {
    var noEnum = function noEnum(v) {
        return { value: v, enumerable: false, writable: true, configurable: true };
    };
    global.Base64.extendString = function () {
        Object.defineProperty(String.prototype, 'fromBase64', noEnum(function () {
            return decode(this);
        }));
        Object.defineProperty(String.prototype, 'toBase64', noEnum(function (urisafe) {
            return encode(this, urisafe);
        }));
        Object.defineProperty(String.prototype, 'toBase64URI', noEnum(function () {
            return encode(this, true);
        }));
    };
}

exports['default'] = global.Base64;
module.exports = exports['default'];

},{"buffer":1}],13:[function(require,module,exports){
/**
 * 内部使用的标准常量.
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});
var FILL_CHAR = '​';
var CONST = {
    //String.fromCharCode(8203)
    FILL_CHAR: FILL_CHAR,
    FILL_CHAR_REG: new RegExp(FILL_CHAR, 'ig'),
    //在此间隔内修订，不生成新的 span，只修改修订时间
    AMEND_TIME_SPACE: 3 * 60 * 1000, // 3分钟
    //在此间隔内修订的内容， 被当作同一批次修订，批量拒绝或接受
    AMEND_BATCH_TIME_SPACE: 30 * 1000, // 30秒
    //判断是否正在进行中文输入法的标识（true 为正在进行中...）
    COMPOSITION_START: false,
    CLASS: {
        IMG_NOT_DRAG: 'wiz-img-cannot-drag',
        IMG_RESIZE_ACTIVE: 'wiz-img-resize-active',
        IMG_RESIZE_CONTAINER: 'wiz-img-resize-container',
        IMG_RESIZE_HANDLE: 'wiz-img-resize-handle',
        SELECTED_CELL: 'wiz-selected-cell',
        TABLE_CONTAINER: 'wiz-table-container',
        TABLE_TOOLS: 'wiz-table-tools',
        TABLE_BODY: 'wiz-table-body',
        TABLE_MENU_BUTTON: 'wiz-table-menu-button',
        TABLE_MENU_ITEM: 'wiz-table-menu-item',
        TABLE_MENU_SUB: 'wiz-table-menu-sub',
        TABLE_MOVING: 'wiz-table-moving',
        TODO_ACCOUNT: 'wiz-todo-account',
        TODO_AVATAR: 'wiz-todo-avatar',
        TODO_CHECKBOX: 'wiz-todo-checkbox',
        TODO_CHECK_IMG_OLD: 'wiz-todo-img',
        TODO_DATE: 'wiz-todo-dt',
        TODO_LAYER: 'wiz-todo-layer',
        TODO_MAIN: 'wiz-todo-main',
        TODO_LABEL_OLD: 'wiz-todo-label',
        TODO_CHECKED: 'wiz-todo-checked',
        TODO_UNCHECKED: 'wiz-todo-unchecked',
        TODO_CHECKED_OLD: 'wiz-todo-label-checked',
        TODO_UNCHECKED_OLD: 'wiz-todo-label-unchecked',
        TODO_TAIL_OLD: 'wiz-todo-tail', //新版本 todoList 取消此元素
        TODO_USER_AVATAR: 'wiz-todo-avatar-',
        TODO_USER_INFO: 'wiz-todo-completed-info'
    },
    ATTR: {
        IMG: 'data-wiz-img',
        IMG_MASK: 'data-wiz-img-mask',
        IMG_RATE: 'data-wiz-img-rate',
        SPAN: 'data-wiz-span',
        SPAN_USERID: 'data-wiz-user-id',
        SPAN_INSERT: 'data-wiz-insert',
        SPAN_DELETE: 'data-wiz-delete',
        SPAN_PASTE: 'data-wiz-paste',
        SPAN_PASTE_TYPE: 'data-wiz-paste-type',
        SPAN_PASTE_ID: 'data-wiz-paste-id',
        SPAN_TIMESTAMP: 'data-wiz-amend-time',
        TODO_ID: 'wiz_todo_id',
        TODO_CHECK: 'data-wiz-check'
    },
    ID: {
        AMEND_INFO: 'wiz-amend-info',
        AMEND_INFO_SINGLE: 'wiz-amend-info-single',
        AMEND_INFO_MULTI: 'wiz-amend-info-multi',
        AMEND_INFO_NAME: 'wiz-amend-info-name',
        AMEND_INFO_IMG: 'wiz-amend-info-image',
        AMEND_INFO_CONTENT: 'wiz-amend-info-content',
        AMEND_INFO_TIME: 'wiz-amend-info-time',
        AMEND_INFO_TOOLS: 'wiz-amend-info-tools',
        AMEND_INFO_ACCEPT: 'wiz-amend-info-accept',
        AMEND_INFO_REFUSE: 'wiz-amend-info-refuse',
        AMEND_USER_INFO: 'wiz-amend-user',
        IFRAME_FOR_SAVE: 'wiz-iframe-for-save',
        TABLE_RANGE_BORDER: 'wiz-table-range-border',
        TABLE_ROW_LINE: 'wiz-table-row-line',
        TABLE_COL_LINE: 'wiz-table-col-line',
        TODO_STYLE: 'wiz_todo_style',
        TODO_STYLE_OLD: 'wiz_todo_style_id',
        TODO_AVATAR_STYLE: 'wiz_todo_style_avatar_',
        WIZ_DEFAULT_STYLE: 'wiz_custom_css'
    },
    NAME: {
        // NO_ABSTRACT_START: 'Document-Abstract-Start',
        // NO_ABSTRACT_END: 'Document-Abstract-End',
        TMP_STYLE: 'wiz_tmp_editor_style'
    },
    NOTE_TYPE: {
        COMMON: 'common',
        MARKDOWN: 'markdown',
        MATHJAX: 'mathjax'
    },
    TAG: {
        TMP_TAG: 'wiz_tmp_tag'
    },
    TYPE: {
        IMG_DELETE: 'delete',
        IMG_INSERT: 'insert',
        PASTE: {
            START: 'start',
            END: 'end',
            CONTENT: 'content'
        },
        POS: {
            upLeft: 'up-left',
            downLeft: 'down-left',
            leftUp: 'left-up',
            rightUp: 'right-up',
            upRight: 'up-right',
            downRight: 'down-right',
            leftDown: 'left-down',
            rightDown: 'right-down'
        },
        TABLE: {
            COPY: 'copy',
            PASTE: 'paste',
            CLEAR_CELL: 'clearCell',
            MERGE_CELL: 'mergeCell',
            SPLIT_CELL: 'splitCell',
            INSERT_ROW_UP: 'insertRowUp',
            INSERT_ROW_DOWN: 'insertRowDown',
            INSERT_COL_LEFT: 'insertColLeft',
            INSERT_COL_RIGHT: 'insertColRight',
            DELETE_ROW: 'deleteRow',
            DELETE_COL: 'deleteCol',
            SET_CELL_BG: 'setCellBg',
            SET_CELL_ALIGN: 'setCellAlign',
            DISTRIBUTE_COLS: 'distributeCols',
            DELETE_TABLE: 'deleteTable'
        },
        TODO: 'tasklist'
    },
    COLOR: ['#CB3C3C', '#0C9460', '#FF3399', '#FF6005', '#8058BD', '#009999', '#8AA725', '#339900', '#CC6600', '#3BBABA', '#D4CA1A', '#2389B0', '#006699', '#FF8300', '#2C6ED5', '#FF0000', '#B07CFF', '#CC3399', '#EB4847', '#3917E6'],
    CSS: {
        IMG: {
            SPAN: {
                position: 'relative',
                display: 'inline-block'
            },
            MASK: {
                position: 'absolute',
                width: '100% !important',
                height: '100% !important',
                top: '0',
                left: '0',
                opacity: '.5',
                filter: 'alpha(opacity=50)',
                border: '2px solid',
                'box-sizing': 'border-box',
                '-webkit-box-sizing': 'border-box',
                '-moz-box-sizing': 'border-box'
            }
        },
        IMG_DELETED: {
            background: '#fdc6c6 url(data:image/gif;base64,R0lGODlhDwAPAIABAIcUFP///yH5BAEKAAEALAAAAAAPAA8AAAIajI8IybadHjxyhjox1I0zH1mU6JCXCSpmUAAAOw==)',
            'border-color': '#E47070'
        },
        IMG_INSERT: {
            background: '#ccffcc',
            'border-color': '#00AA00'
        },
        TODO_LIST: {
            IMG_WIDTH: 40
        },
        Z_INDEX: {
            amendInfo: 150,
            tableBorder: 105,
            tableColRowLine: 120,
            tableRangeDot: 110,
            tableTDBefore: 100,
            tableTools: 130,
            tableToolsArrow: 10
        }
    },
    //客户端相关的事件定义
    CLIENT_EVENT: {
        WizEditorPaste: 'wizEditorPaste',
        wizReaderClickImg: 'wizReaderClickImg',
        wizMarkdownRender: 'wizMarkdownRender',
        wizEditorTrackEvent: 'wizEditorTrackEvent'
    },
    //全局事件 id 集合
    EVENT: {
        BEFORE_GET_DOCHTML: 'BEFORE_GET_DOCHTML',
        BEFORE_SAVESNAP: 'BEFORE_SAVESNAP',
        AFTER_RESTORE_HISTORY: 'AFTER_RESTORE_HISTORY',

        ON_CLICK: 'ON_CLICK',
        ON_COMPOSITION_START: 'ON_COMPOSITION_START',
        ON_COMPOSITION_END: 'ON_COMPOSITION_END',
        ON_COPY: 'ON_COPY',
        ON_CUT: 'ON_CUT',
        ON_DRAG_START: 'ON_DRAG_START',
        ON_DRAG_ENTER: 'ON_DRAG_ENTER',
        ON_DROP: 'ON_DROP',
        ON_KEY_DOWN: 'ON_KEY_DOWN',
        ON_KEY_UP: 'ON_KEY_UP',
        ON_MOUSE_DOWN: 'ON_MOUSE_DOWN',
        ON_MOUSE_MOVE: 'ON_MOUSE_MOVE',
        ON_MOUSE_OVER: 'ON_MOUSE_OVER',
        ON_MOUSE_UP: 'ON_MOUSE_UP',
        ON_PASTE: 'ON_PASTE',
        ON_SCROLL: 'ON_SCROLL',
        ON_SELECT_CHANGE: 'ON_SELECT_CHANGE',
        ON_SELECT_START: 'ON_SELECT_START',
        ON_TOUCH_START: 'ON_TOUCH_START',
        ON_TOUCH_END: 'ON_TOUCH_END',
        UPDATE_RENDER: 'UPDATE_RENDER'
    },
    AMEND: {
        INFO_SPACE: 0, //修订信息图层与目标间隔
        INFO_TIMER: 300 //修订timer 间隔
    }
};

exports['default'] = CONST;
module.exports = exports['default'];

},{}],14:[function(require,module,exports){
/**
 * 依赖的 css && 非可打包的 js 文件加载控制
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _utils = require('./utils');

var _utils2 = _interopRequireDefault(_utils);

var _scriptLoader = require('./scriptLoader');

var _scriptLoader2 = _interopRequireDefault(_scriptLoader);

function loadGroup(doc, group, callback) {
    _scriptLoader2['default'].load(doc, group, callback);
}

function makeCallback(doc, loadFiles, callback) {
    var count = 0,
        max = loadFiles.length;

    var cb = function cb() {
        if (count < max) {
            loadGroup(doc, loadFiles[count++], cb);
        } else if (callback) {
            callback();
        }
    };

    return cb;
}

var dependLoader = {
    loadJs: function loadJs(doc, loadFiles, callback) {
        var cb = makeCallback(doc, loadFiles, callback);
        cb();
    },
    loadCss: function loadCss(doc, loadFiles) {
        var i, j;
        for (i = 0, j = loadFiles.length; i < j; i++) {
            _utils2['default'].loadSingleCss(doc, loadFiles[i]);
        }
    }
};

exports['default'] = dependLoader;
module.exports = exports['default'];

},{"./scriptLoader":18,"./utils":19}],15:[function(require,module,exports){
/**
 * wizEditor 环境参数，保存当前 document 等
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _const = require('./const');

var _const2 = _interopRequireDefault(_const);

var _lang = require('./lang');

var GlobalEvent = {};
var WizNotCmdInditify = 'wiznotecmd://';

var ENV = {
    options: {
        document: null,
        lang: 'en',
        clientType: '',
        noteType: 'common',
        userInfo: null,
        userData: [],
        dependencyCss: {
            fonts: '',
            github2: '',
            wizToc: ''
        },
        dependencyJs: {
            jquery: '',
            prettify: '',
            raphael: '',
            underscore: '',
            flowchart: '',
            sequence: '',
            mathJax: ''
        },
        maxRedo: 100, //only for editor
        noAmend: false, //only for read
        table: { //only for editor
            colWidth: 120, //默认列宽
            colWidthMin: 30, //最小列宽
            rowHeightMin: 33 //最小行高
        },
        timeout: { //only for read
            markdown: 30 * 1000,
            mathJax: 30 * 1000
        },
        callback: {
            markdown: null, //only for read
            mathJax: null, //only for read
            redo: null //only for editor
        }
    },
    init: function init(type, _options) {
        setOptions(ENV.options, _options);

        var doc = ENV.options.document || window.document;
        ENV.doc = doc;
        ENV.win = ENV.doc.defaultView;
        (0, _lang.initLang)(ENV.options.lang);
        ENV.client.setType(ENV.options.clientType);

        function setOptions(old, newOptions) {
            if (!newOptions) {
                return;
            }
            var k;
            for (k in old) {
                if (old.hasOwnProperty(k) && newOptions[k]) {
                    if (/^(table|timeout|callback|dependencyCss|dependencyJs)$/.test(k)) {
                        setOptions(old[k], newOptions[k]);
                    } else {
                        old[k] = newOptions[k];
                    }
                }
            }
        }
    },
    win: null,
    doc: null,
    readonly: true,
    dependency: {
        files: {
            css: {
                fonts: '',
                github2: '',
                wizToc: ''
            },
            js: {
                jquery: '',
                prettify: '',
                raphael: '',
                underscore: '',
                flowchart: '',
                sequence: '',
                mathJax: 'http://cdn.mathjax.org/mathjax/latest/MathJax.js?config=TeX-MML-AM_CHTML'
            },
            init: function init() {
                var cssFiles = ENV.options.dependencyCss;
                var jsFiles = ENV.options.dependencyJs;

                _append('fonts', cssFiles, ENV.dependency.files.css);
                _append('github2', cssFiles, ENV.dependency.files.css);
                _append('wizToc', cssFiles, ENV.dependency.files.css);

                _append('jquery', jsFiles, ENV.dependency.files.js);
                _append('prettify', jsFiles, ENV.dependency.files.js);
                _append('raphael', jsFiles, ENV.dependency.files.js);
                _append('underscore', jsFiles, ENV.dependency.files.js);
                _append('flowchart', jsFiles, ENV.dependency.files.js);
                _append('sequence', jsFiles, ENV.dependency.files.js);
                _append('mathJax', jsFiles, ENV.dependency.files.js);

                function _append(id, src, target) {
                    if (!src || !target) {
                        return;
                    }

                    if (src[id]) {
                        target[id] = src[id];
                    }
                }
            }
        },
        css: {
            fonts: ['fonts'],
            markdown: ['github2', 'wizToc']
        },
        js: {
            markdown: [['jquery'], ['prettify', 'raphael', 'underscore'], ['flowchart', 'sequence']],
            mathJax: [['jquery'], ['mathJax']]
        }
    },
    /**
     * 客户端类型 & 功能设置
     */
    client: {
        type: {
            isWeb: (function () {
                return location && location.protocol.indexOf('http') === 0;
            })(),
            isWin: false,
            isMac: false,
            isIOS: false,
            isAndroid: false,
            isPad: false,
            isPhone: false
        },
        sendCmdToWiznote: function sendCmdToWiznote() {},
        setType: function setType(type) {
            if (!type) {
                return;
            }
            type = type.toLowerCase();
            if (type.indexOf('windows') > -1) {
                ENV.client.type.isWin = true;
            } else if (type.indexOf('ios') > -1) {
                ENV.client.type.isIOS = true;
                ENV.client.sendCmdToWiznote = function (cmd, options) {
                    var url;
                    if (cmd == _const2['default'].CLIENT_EVENT.wizReaderClickImg) {
                        url = WizNotCmdInditify + cmd + '?src=' + encodeURIComponent(options.src);
                    } else if (cmd == _const2['default'].CLIENT_EVENT.wizEditorTrackEvent) {
                        url = WizNotCmdInditify + cmd + '?id=' + encodeURIComponent(options.id) + '&e=' + encodeURIComponent(options.event);
                    } else {
                        url = WizNotCmdInditify + cmd;
                    }

                    var iframe = ENV.doc.createElement("iframe");
                    iframe.setAttribute("src", url);
                    ENV.doc.documentElement.appendChild(iframe);
                    iframe.parentNode.removeChild(iframe);
                    iframe = null;
                };
            } else if (type.indexOf('android') > -1) {
                ENV.client.type.isAndroid = true;
                ENV.client.sendCmdToWiznote = function (cmd, options) {
                    if (cmd == _const2['default'].CLIENT_EVENT.wizReaderClickImg) {
                        ENV.win.WizNote.onClickImg(options.src, options.imgList);
                    }
                };
            } else if (type.indexOf('mac') > -1) {
                ENV.client.type.isMac = true;
            }

            if (ENV.client.type.isIOS || ENV.client.type.isAndroid) {
                if (type.indexOf('pad') > -1) {
                    ENV.client.type.isPad = true;
                } else {
                    ENV.client.type.isPhone = true;
                }
            }
        }
    },
    event: {
        add: function add(eventId, fun) {
            if (!eventId || !fun || checkFun(eventId, fun)) {
                return;
            }
            var eList = GlobalEvent[eventId];
            if (!eList) {
                eList = [];
            }
            eList.push(fun);
            GlobalEvent[eventId] = eList;

            function checkFun(eventId, fun) {
                if (!eventId || !fun) {
                    return false;
                }
                var i,
                    j,
                    eList = GlobalEvent[eventId];

                if (!eList || eList.length === 0) {
                    return false;
                }
                for (i = 0, j = eList.length; i < j; i++) {
                    if (eList[i] === fun) {
                        return true;
                    }
                }
                return false;
            }
        },
        call: function call(eventId) {
            var i,
                j,
                args = [],
                eList = GlobalEvent[eventId];

            if (!eList || eList.length === 0) {
                return;
            }
            for (i = 1, j = arguments.length; i < j; i++) {
                args.push(arguments[i]);
            }
            for (i = 0, j = eList.length; i < j; i++) {
                eList[i].apply(this, args);
            }
        },
        remove: function remove(eventId, fun) {
            if (!eventId || !fun) {
                return;
            }
            var i,
                j,
                eList = GlobalEvent[eventId];

            if (!eList || eList.length === 0) {
                return;
            }
            for (i = 0, j = eList.length; i < j; i++) {
                if (eList[i] === fun) {
                    eList.splice(i, 1);
                }
            }
        }
    }
};

exports['default'] = ENV;
module.exports = exports['default'];

},{"./const":13,"./lang":17}],16:[function(require,module,exports){
/**
 * undo、redo 工具包
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _env = require('./env');

var _env2 = _interopRequireDefault(_env);

var _const = require('./const');

var _const2 = _interopRequireDefault(_const);

var _utils = require('./utils');

var _utils2 = _interopRequireDefault(_utils);

var _domUtilsDomExtend = require('./../domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

var _rangeUtilsRangeExtend = require('./../rangeUtils/rangeExtend');

var _rangeUtilsRangeExtend2 = _interopRequireDefault(_rangeUtilsRangeExtend);

var MaxRedo = 100;
var historyUtils = {
    enable: false,
    /**
     * 执行 undo 操作时，触发的回调函数， 返回 history 的缓存集合数量，以及当前 undo、redo 操作游标的所在位置——用于控制 undo、redo 按钮的 disabled
     */
    callback: null,
    /**
     * undo 集合
     */
    stack: [],
    /**
     * undo 集合当前游标位置
     */
    stackIndex: 0,
    /**
     * 初始化 historyUtils 工具包
     */
    init: function init() {
        historyUtils.stack = [];
        historyUtils.stackIndex = 0;
    },
    /**
     * 开启 history 功能
     * @param maxRedo
     * @param callback
     */
    start: function start(maxRedo, callback) {
        if (maxRedo && maxRedo > 0) {
            MaxRedo = maxRedo;
        }
        historyUtils.enable = true;
        historyUtils.init();
        historyEvent.bind();
        if (callback) {
            historyUtils.callback = callback;
        }
    },
    /**
     * 关闭 history 功能
     */
    stop: function stop() {
        historyUtils.enable = false;
        historyUtils.init();
        historyEvent.unbind();
    },
    /**
     * 触发 callback
     */
    applyCallback: function applyCallback() {
        if (historyUtils.callback) {
            historyUtils.callback(historyUtils.getUndoState());
        }
    },
    getUndoState: function getUndoState() {
        return {
            'undoCount': historyUtils.stack.length,
            'undoIndex': historyUtils.stackIndex
        };
    },
    /**
     * undo 操作
     */
    undo: function undo() {
        //console.log('.....undo....');
        if (!historyUtils.enable || historyUtils.stackIndex <= 0 || historyUtils.stack.length === 0) {
            historyUtils.stackIndex = 0;
            return;
        }
        if (historyUtils.stackIndex >= historyUtils.stack.length) {
            historyUtils.saveSnap(true);
        }
        //console.log('.....restore.....' + historyUtils.stack.length + ',' + historyUtils.stackIndex);
        historyUtils.restore(historyUtils.stack[--historyUtils.stackIndex]);
        historyUtils.applyCallback();
        _domUtilsDomExtend2['default'].focus();
        //            console.log('undo: ' + historyUtils.stackIndex);
    },
    /**
     * redo 操作
     */
    redo: function redo() {
        //console.log('.....redo....');
        if (!historyUtils.enable || historyUtils.stackIndex >= historyUtils.stack.length - 1) {
            return;
        }
        historyUtils.restore(historyUtils.stack[++historyUtils.stackIndex]);
        historyUtils.applyCallback();
        _domUtilsDomExtend2['default'].focus();
        //            console.log('redo: ' + historyUtils.stackIndex);
    },
    /**
     * 保存当前内容的快照
     * @param keepIndex （是否保存快照时不移动游标， 主要用于 undo 操作时保存最后的快照）
     */
    saveSnap: function saveSnap(keepIndex) {
        if (!historyUtils.enable || _const2['default'].COMPOSITION_START) {
            return;
        }

        _env2['default'].event.call(_const2['default'].EVENT.BEFORE_SAVESNAP);

        var canSave = { add: true, replace: false, direct: 0 },
            snap = historyUtils.snapshot();
        if (!keepIndex && historyUtils.stack.length > 0 && historyUtils.stackIndex > 0) {
            canSave = historyUtils.canSave(snap, historyUtils.stack[historyUtils.stackIndex - 1]);
        }
        if (canSave.add || canSave.replace) {
            //console.log('save snap.... stack: [' + historyUtils.stack.length + ']  index: [' + historyUtils.stackIndex + ']  keepIndex: [' + !!keepIndex + ']');
            //记录 光标移动方向，用于判断是删除还是添加字符
            snap.direct = canSave.direct;

            if (historyUtils.stackIndex >= 0) {
                historyUtils.stack.splice(historyUtils.stackIndex, historyUtils.stack.length - historyUtils.stackIndex);
            }
            //                console.log(snap.content);
            if (canSave.add) {
                // console.log('save snap.add.... stack: [' + historyUtils.stack.length + ']  index: [' + historyUtils.stackIndex + ']  keepIndex: [' + !!keepIndex + ']');
                historyUtils.stack.push(snap);
                if (!keepIndex) {
                    historyUtils.stackIndex++;
                }
            } else if (canSave.replace) {
                //console.log('save snap.replace.... stack: [' + historyUtils.stack.length + ']  index: [' + historyUtils.stackIndex + ']  keepIndex: [' + !!keepIndex + ']');
                historyUtils.stack[historyUtils.stackIndex - 1] = snap;
                if (keepIndex) {
                    historyUtils.stackIndex--;
                }
            }
        }

        if (historyUtils.stack.length > MaxRedo) {
            historyUtils.stack.shift();
            historyUtils.stackIndex--;
        }
        historyUtils.applyCallback();
    },
    /**
     * 根据指定的 快照 恢复页面内容
     * @param snap
     */
    restore: function restore(snap) {
        if (!historyUtils.enable || !snap) {
            return;
        }
        var sel = _env2['default'].doc.getSelection(),
            start,
            end;
        _env2['default'].doc.body.innerHTML = snap.content;
        try {
            start = _domUtilsDomExtend2['default'].getDomByIndexList(snap.focus.start);
            sel.collapse(start.dom, start.offset);
            if (!snap.focus.isCollapsed) {
                end = _domUtilsDomExtend2['default'].getDomByIndexList(snap.focus.end);
                _rangeUtilsRangeExtend2['default'].setRange(start.dom, start.offset, end.dom, end.offset);
            } else {
                _rangeUtilsRangeExtend2['default'].setRange(start.dom, start.offset, start.dom, start.offset);
            }
            _rangeUtilsRangeExtend2['default'].caretFocus();
        } catch (e) {}
        _env2['default'].event.call(_const2['default'].EVENT.AFTER_RESTORE_HISTORY);
    },
    /**
     * 判断 当前快照是否可以保存
     * @param s1
     * @param s2
     * @returns {{add: boolean, replace: boolean}}
     */
    canSave: function canSave(s1, s2) {
        var result = { add: false, replace: false, direct: 0 };
        if (s1.content.length != s2.content.length || !!s1.content.localeCompare(s2.content)) {
            result.direct = compareFocus(s1.focus, s2.focus);
            if (result.direct === 0 || result.direct !== s2.direct) {
                result.add = true;
            } else {
                result.replace = true;
            }
        }
        //console.log(' ..... can Save .....')
        //console.log(s1)
        //console.log(s2)
        //console.log(result)
        return result;

        function compareFocus(f1, f2) {
            if (f1.isCollapsed != f2.isCollapsed) {
                return 0;
            }
            if (f1.start.length != f2.start.length || f1.end.length != f2.end.length) {
                return 0;
            }
            var result = compareIndexList(f1.start, f2.start);
            if (result < 1) {
                return result;
            }
            result = compareIndexList(f1.end, f2.end);
            return result;
        }

        function compareIndexList(index1, index2) {
            var isSame = 1,
                i,
                j;
            for (i = 0, j = index1.length - 1; i < j; i++) {
                if (index1[i] != index2[i]) {
                    isSame = 0;
                    break;
                }
            }
            if (isSame && index1[j] < index2[j]) {
                isSame = -1;
            }
            //console.log('.....compareIndexList.....')
            //console.log(index1)
            //console.log(index2)
            //console.log(isSame)
            return isSame;
        }
    },
    /**
     * 生成快照
     * @returns {{content: string, focus: {isCollapsed: boolean, start: Array, end: Array}}}
     */
    snapshot: function snapshot() {
        var sel = _env2['default'].doc.getSelection(),
            content = _env2['default'].doc.body.innerHTML,
            focus = {
            isCollapsed: true,
            start: [],
            end: []
        },
            snap = {
            content: content,
            focus: focus
        };

        if (sel.rangeCount === 0) {
            focus.start.push(0);
            return snap;
        }

        var range = sel.getRangeAt(0);
        focus.start = _domUtilsDomExtend2['default'].getIndexListByDom(range.startContainer);
        focus.start.push(range.startOffset);
        focus.isCollapsed = sel.isCollapsed;
        if (!sel.isCollapsed) {
            focus.end = _domUtilsDomExtend2['default'].getIndexListByDom(range.endContainer);
            focus.end.push(range.endOffset);
        }
        return snap;
    }
};

/**
 * 历史记录功能的 事件处理
 */
var historyEvent = {
    /**
     * 初始化时， 绑定历史记录相关的必要事件
     */
    bind: function bind() {
        historyEvent.unbind();
        _env2['default'].event.add(_const2['default'].EVENT.ON_KEY_DOWN, historyEvent.onKeyDown);
    },
    /**
     * 解绑历史记录相关的必要事件
     */
    unbind: function unbind() {
        _env2['default'].event.remove(_const2['default'].EVENT.ON_KEY_DOWN, historyEvent.onKeyDown);
    },
    /**
     * 快捷键 监控
     * @param e
     */
    onKeyDown: function onKeyDown(e) {

        var keyCode = e.keyCode || e.which;
        //console.log('history keydown.....' + keyCode);

        /**
         * Ctrl + Z
         */
        if (e.ctrlKey && keyCode == 90 || e.metaKey && keyCode == 90 && !e.shiftKey) {
            historyUtils.undo();
            _utils2['default'].stopEvent(e);
            return;
        }
        /**
         * Ctrl + Y
         */
        if (e.ctrlKey && keyCode == 89 || e.metaKey && keyCode == 89 || e.metaKey && keyCode == 90 && e.shiftKey) {
            historyUtils.redo();
            _utils2['default'].stopEvent(e);
        }
    }
};

exports['default'] = historyUtils;
module.exports = exports['default'];

},{"./../domUtils/domExtend":24,"./../rangeUtils/rangeExtend":36,"./const":13,"./env":15,"./utils":19}],17:[function(require,module,exports){
/**
 * Created by ZQG on 2015/3/11.
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});
var LANG = {},
    userLangType = 'en',
    userLang = {};
LANG['en'] = {
    version: 'en',
    Month: ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Agu.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'],
    Amend: {
        Edit: 'Inserted contents',
        Delete: 'Deleted contents',
        BtnAccept: 'Accept',
        BtnRefuse: 'Reject',
        Accept: 'Accept all changes? Or partially select the changes which need to be accepted.',
        Refuse: 'Reject all changes? Or partially select the changes which need to be rejected.',
        MultiInfo: 'Multiple changes are selected',
        UserNameDefault: 'someone'
    },
    Table: {
        Copy: 'Copy',
        Paste: 'Paste',
        ClearCell: 'Clear',
        MergeCell: 'Merge Cells',
        SplitCell: 'Unmerge Cells',
        InsertRowUp: 'Add Row Above',
        InsertRowDown: 'Add Row Below',
        InsertColLeft: 'Add Column Before',
        InsertColRight: 'Add Column After',
        DeleteRow: 'Delete Row',
        DeleteCol: 'Delete Column',
        SetCellBg: 'Color Fill',
        CellAlign: 'Arrange',
        DeleteTable: 'Delete Table',
        DistributeCols: 'Average Column Width'
    },
    Err: {
        Copy_Null: 'Copy of deleted changes not allowed',
        Cut_Null: 'Cut of deleted changes not allowed'
    }
};
LANG['zh-cn'] = {
    version: 'zh-cn',
    Date: {
        Year: '年',
        Month: '月',
        Day: '日'
    },
    Amend: {
        Edit: '插入了内容',
        Delete: '删除了内容',
        BtnAccept: '接受修订',
        BtnRefuse: '拒绝修订',
        Accept: '是否确认接受全部修订内容？ 如需接受部分内容请使用鼠标进行选择',
        Refuse: '是否确认拒绝全部修订内容？ 如需拒绝部分内容请使用鼠标进行选择',
        MultiInfo: '您选中了多处修订',
        UserNameDefault: '有人'
    },
    Table: {
        Copy: '复制',
        Paste: '粘贴',
        ClearCell: '清空单元格',
        MergeCell: '合并单元格',
        SplitCell: '拆分单元格',
        InsertRowUp: '上插入行',
        InsertRowDown: '下插入行',
        InsertColLeft: '左插入列',
        InsertColRight: '右插入列',
        DeleteRow: '删除当前行',
        DeleteCol: '删除当前列',
        SetCellBg: '单元格底色',
        CellAlign: '单元格对齐方式',
        DeleteTable: '删除表格',
        DistributeCols: '平均分配各列'
    },
    Err: {
        Copy_Null: '无法复制已删除的内容',
        Cut_Null: '无法剪切已删除的内容'
    }
};
LANG['zh-tw'] = {
    version: 'zh-tw',
    Date: {
        Year: '年',
        Month: '月',
        Day: '日'
    },
    Amend: {
        Edit: '插入了內容',
        Delete: '刪除了內容',
        BtnAccept: '接受修訂',
        BtnRefuse: '拒絕修訂',
        Accept: '是否確認接受全部修訂內容？ 如需接受部分內容請使用滑鼠進行選擇',
        Refuse: '是否確認拒絕全部修訂內容？ 如需拒絕部分內容請使用滑鼠進行選擇',
        MultiInfo: '您選中了多處修訂',
        UserNameDefault: '有人'
    },
    Table: {
        Copy: '複製',
        Paste: '粘貼',
        ClearCell: '清空儲存格',
        MergeCell: '合併儲存格',
        SplitCell: '拆分儲存格',
        InsertRowUp: '上插入行',
        InsertRowDown: '下插入行',
        InsertColLeft: '左插入列',
        InsertColRight: '右插入列',
        DeleteRow: '刪除當前行',
        DeleteCol: '刪除當前列',
        SetCellBg: '儲存格底色',
        CellAlign: '儲存格對齊方式',
        DeleteTable: '刪除表格',
        DistributeCols: '平均分配各列'
    },
    Err: {
        Copy_Null: '無法複製已刪除的內容',
        Cut_Null: '無法剪切已刪除的內容'
    }
};

function setLang(type) {
    if (!type) {
        type = 'en';
    }
    //同时支持 zh-cn & zh_cn
    type = type.toLowerCase().replace('_', '-');
    if (LANG[type]) {
        userLangType = type;
    } else {
        type = 'en';
    }

    var k;
    for (k in LANG[type]) {
        if (LANG[type].hasOwnProperty(k)) {
            userLang[k] = LANG[type][k];
        }
    }
}

exports['default'] = userLang;

/**
 * 初始化语言文件
 * @param lang
 */
var initLang = function initLang(type) {
    setLang(type);
};
exports.initLang = initLang;

},{}],18:[function(require,module,exports){
/*
 *用于加载js
 *options是数组，值有
 *  字符串：js地址
 *  对象(js需保存到localStorage)：
 *      {
 *         id:"",
 *         version:"",
 *         link:""
 *      }
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _const = require('./const');

var _const2 = _interopRequireDefault(_const);

var _utils = require('./utils');

var _utils2 = _interopRequireDefault(_utils);

var scriptLoader = {
    appendJsCode: function appendJsCode(doc, jsStr, type) {
        var s = doc.createElement('script');
        s.type = type;
        s.text = jsStr;
        //s.className = this.PcCustomTagClass;
        doc.getElementsByTagName('head')[0].appendChild(s);
    },
    load: function load(doc, options, callback) {
        if (!doc || !options) {
            return;
        }
        var i,
            j,
            s,
            c,
            id = new Date().valueOf(),
            allLoaded = true;
        for (i = 0, j = options.length; i < j; i++) {
            if (typeof options[i] == "string") {
                s = this.loadSingleJs(doc, options[i]);
                if (s !== true) {
                    s.onload = makeLoadHandle(id, callback);
                    allLoaded = false;
                }
            } else {
                var jsUrl = options[i].link,
                    jsId = createJsId(options[i].id),
                    jsVersion = options[i].version;
                if (window.localStorage) {
                    var jsInfo = JSON.parse(localStorage.getItem(jsId));
                    if (jsInfo && jsInfo.version == jsVersion) {
                        s = this.inject(doc, jsInfo.jsStr, jsId);
                        if (s !== true) {
                            c = makeLoadHandle(id, callback);
                            setTimeout(function () {
                                c();
                            }, 10);
                            allLoaded = false;
                        }
                    } else {
                        allLoaded = false;
                        c = makeLoadHandle(id, callback);
                        $.ajax({
                            url: jsUrl,
                            context: { id: jsId, version: jsVersion },
                            success: function success(data) {
                                save({ id: this.id, version: this.version, jsStr: data });
                                s = wizUI.scriptLoader.inject(doc, data, this.id);
                                if (s !== true) {
                                    setTimeout(function () {
                                        c();
                                    }, 10);
                                }
                            },
                            error: function error() {
                                c();
                            }
                        });
                    }
                } else {
                    s = this.loadSingleJs(doc, options[i].link);
                    if (s !== true) {
                        s.onload = makeLoadHandle(id, callback);
                        allLoaded = false;
                    }
                }
            }
        }
        if (allLoaded) {
            callback();
        }
    },
    loadSingleJs: function loadSingleJs(doc, path) {
        var jsId = 'wiz_' + path;
        if (doc.getElementById(jsId)) {
            return true;
        }
        var s = doc.createElement('script');
        s.type = 'text/javascript';
        s.setAttribute('charset', "utf-8");
        s.src = path.replace(/\\/g, '/');
        s.id = jsId;
        //s.className = utils.PcCustomTagClass;
        doc.getElementsByTagName('head')[0].insertBefore(s, null);
        return s;
    },
    inject: function inject(doc, jsStr, jsId) {
        if (!doc || doc.getElementById(jsId)) {
            return true;
        }
        var s = doc.createElement("script");
        s.type = 'text/javascript';
        s.id = jsId;
        s.text = jsStr;
        //s.className = utils.PcCustomTagClass;
        doc.getElementsByTagName('head')[0].insertBefore(s, null);
        return s;
    }
};
var loadCount = {};

function makeLoadHandle(id, loadCallback) {
    if (!loadCount[id]) {
        loadCount[id] = 0;
    }
    loadCount[id]++;
    return function () {
        loadCount[id]--;
        if (loadCount[id] === 0) {
            loadCount[id] = null;
            if (loadCallback) {
                loadCallback();
            }
        }
    };
}

function createJsId(jsId) {
    return "wiz_js_" + jsId;
}

function save(options) {
    if (!options) {
        return;
    }
    var jsInfo = {
        version: options.version,
        jsStr: options.jsStr
    };
    localStorage.setItem(options.id, JSON.stringify(jsInfo));
}

exports['default'] = scriptLoader;
module.exports = exports['default'];

},{"./const":13,"./utils":19}],19:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _const = require('./const');

var _const2 = _interopRequireDefault(_const);

if (!String.prototype.trim) {
    String.prototype.trim = function () {
        return this.replace(/^\s+|\s+$/g, '');
    };
}
if (!Array.prototype.indexOf) {
    Array.prototype.indexOf = function (n) {
        for (var i = 0; i < this.length; i++) {
            if (this[i] == n) {
                return i;
            }
        }
        return -1;
    };
}

/**
 * 常用基本工具包
 */
var utils = {
    /**
     * 检查 是否为有效的键盘输入内容
     * @param e
     * @returns {boolean}
     */
    checkNonTxtKey: function checkNonTxtKey(e) {
        var keyCode = e.keyCode || e.which;
        if (e.ctrlKey || e.metaKey) {
            return true;
        }
        return !(keyCode >= 48 && keyCode <= 57 || //0-9
        keyCode >= 65 && keyCode <= 90 || //a-z
        keyCode >= 96 && keyCode <= 107 || //小键盘0-9 * +
        keyCode >= 109 && keyCode <= 111 || //小键盘 / * -
        keyCode >= 186 && keyCode <= 192 || //标点符号
        keyCode >= 219 && keyCode <= 222 || //标点符号
        keyCode == 229 || keyCode === 0 || //中文
        keyCode == 13 || //Enter
        keyCode == 32) //空格
        ;
    },
    /**
     * 判断 obj 是否为 数组
     * @param obj
     * @returns {boolean}
     */
    isArray: function isArray(obj) {
        return Object.prototype.toString.apply(obj) === "[object Array]";
    },
    /**
     * 判断字符串是否为空， 空格 不认为空
     * @param str
     * @returns {boolean}
     */
    isEmpty: function isEmpty(str) {
        if (!str) {
            return true;
        }
        var enter = /\r?\n/ig,
            r = new RegExp('[\r\n' + _const2['default'].FILL_CHAR + ']', 'ig'),
            hasEnter = enter.test(str),
            _str = str.replace(r, ''),
            isNone = str.replace(r, '').trim().length === 0;
        //避免 正常标签只存在 一个空格时，也被误判
        return _str.length === 0 || hasEnter && isNone;
    },
    /**
     * 判断两个 修订时间是否近似相同
     * @param time1
     * @param time2
     * @returns {boolean}
     */
    isSameAmendTime: function isSameAmendTime(time1, time2) {
        if (!time1 || !time2) {
            return false;
        }
        var t1 = utils.getDateForTimeStr(time1),
            t2 = utils.getDateForTimeStr(time2);
        return Math.abs(t1 - t2) <= _const2['default'].AMEND_BATCH_TIME_SPACE;
    },
    getEventClientPos: function getEventClientPos(e) {
        return {
            x: e.changedTouches ? e.changedTouches[0].clientX : e.clientX,
            y: e.changedTouches ? e.changedTouches[0].clientY : e.clientY
        };
    },
    /**
     * 获取字符串 的 hash 值
     * @param str
     * @returns {number}
     */
    getHash: function getHash(str) {
        var hash = 1315423911,
            i,
            ch;
        for (i = str.length - 1; i >= 0; i--) {
            ch = str.charCodeAt(i);
            hash ^= (hash << 5) + ch + (hash >> 2);
        }
        return hash & 0x7FFFFFFF;
    },
    /**
     * 生成当前时间戳，用于 修订的时间
     * @returns {string}
     */
    getTime: function getTime() {
        var d = new Date();
        return d.getFullYear() + '-' + to2(d.getMonth() + 1) + '-' + to2(d.getDate()) + ' ' + to2(d.getHours()) + ':' + to2(d.getMinutes()) + ':' + to2(d.getSeconds());

        function to2(num) {
            var str = num.toString();
            return str.length == 1 ? '0' + str : str;
        }
    },
    /**
     * 根据 日期字符串 返回 Date 对象（用于修订编辑，所以只支持 yyyy-mm-hh HH:MM:SS 格式）
     * @param str
     * @returns {Date}
     */
    getDateForTimeStr: function getDateForTimeStr(str) {
        return new Date(Date.parse(str.replace(/-/g, "/")));
    },
    /**
     * 将 list 转换为 Map （主要用于处理 tagNames）
     * @param list
     * @returns {{}}
     */
    listToMap: function listToMap(list) {
        if (!list) {
            return {};
        }
        list = utils.isArray(list) ? list : list.split(',');
        var i,
            j,
            ci,
            obj = {};
        for (i = 0, j = list.length; i < j; i++) {
            ci = list[i];
            obj[ci.toUpperCase()] = obj[ci] = 1;
        }
        return obj;
    },
    rgb2Hex: function rgb2Hex(str) {
        if (!str) {
            return '';
        }
        var rgb = str.replace(/.*\((.*)\)/ig, '$1').split(',');
        if (rgb.length < 3) {
            return '';
        }
        var r = parseInt(rgb[0], 10),
            g = parseInt(rgb[1], 10),
            b = parseInt(rgb[2], 10),
            a = rgb.length === 4 ? parseFloat(rgb[3]) : 1;
        if (a === 0) {
            return '';
        }
        return '#' + getHex(getColor(r, a)) + getHex(getColor(g, a)) + getHex(getColor(b, a));

        function getColor(color, colorA) {
            return color + Math.floor((255 - color) * (1 - colorA));
        }
        function getHex(n) {
            var h = n.toString(16);
            return h.length == 1 ? '0' + h : h;
        }
    },
    /**
     * 删除 数组中重复的数据
     * @param arr
     * @returns {Array}
     */
    removeDup: function removeDup(arr) {
        var result = [],
            i,
            j,
            a;
        for (i = 0, j = arr.length; i < j; i++) {
            a = arr[i];
            if (result.indexOf(a) < 0) {
                result.push(a);
            }
        }
        return result;
    },
    /**
     * 阻止默认事件
     * @param e
     */
    stopEvent: function stopEvent(e) {
        if (!e) {
            return;
        }
        e.stopPropagation();
        e.preventDefault();
        //这个会阻止其他同event 的触发，过于野蛮
        //e.stopImmediatePropagation();
    },
    //-------------------- 以下内容修改需要 保证与 wizUI 中的 utils 内 对应方法一致 start ----------------------
    //PcCustomTagClass: 'wiz-html-render-unsave', //此 class 专门用于 pc 端将 markdown 笔记选然后发email 或微博等处理
    WizEditorTmpName: 'wiz_tmp_editor_style', //WizEditor 专用临时 style
    loadSingleCss: function loadSingleCss(doc, path) {
        var cssId = 'wiz_' + path;
        if (doc.getElementById(cssId)) {
            return true;
        }

        var s = doc.createElement('link');
        s.rel = 'stylesheet';
        s.setAttribute('charset', "utf-8");
        s.setAttribute('name', this.WizEditorTmpName);
        s.href = path.replace(/\\/g, '/');
        //s.className = this.PcCustomTagClass;
        doc.getElementsByTagName('head')[0].insertBefore(s, null);
        return s;
    },
    appendCssCode: function appendCssCode(doc, jsStr, type) {
        var s = doc.createElement('style');
        s.type = type;
        s.text = jsStr;
        s.setAttribute('name', this.WizEditorTmpName);
        //s.className = this.PcCustomTagClass;
        doc.getElementsByTagName('head')[0].appendChild(s);
    },
    /**
     * FF下无法获取innerText，通过解析DOM树来解析innerText，来渲染markdown
     * @param ele 需要解析的节点元素
     * @returns {string}
     */
    getInnerText: function getInnerText(ele) {

        var t = '';

        var normalize = function normalize(a) {
            if (!a) {
                return "";
            }
            return a.replace(/ +/gm, " ").replace(/[\t]+/gm, "").replace(/[ ]+$/gm, "").replace(/^[ ]+/gm, "").replace(/\n+/gm, "\n").replace(/\n+$/, "").replace(/^\n+/, "").replace(/NEWLINE/gm, '\n');
            //return a.replace(/ +/g, " ")
            //    .replace(/[\t]+/gm, "")
            //    .replace(/[ ]+$/gm, "")
            //    .replace(/^[ ]+/gm, "")
            //    .replace(/\n+/g, "\n")
            //    .replace(/\n+$/, "")
            //    .replace(/^\n+/, "")
        };
        var removeWhiteSpace = function removeWhiteSpace(node) {
            // 去掉空的文本节点
            var isWhite = function isWhite(node) {
                return !/[^\t\n\r ]/.test(node.nodeValue);
            };
            var ws = [];
            var findWhite = function findWhite(node) {
                for (var i = 0; i < node.childNodes.length; i++) {
                    var n = node.childNodes[i];
                    if (n.nodeType == 3 && isWhite(n)) {
                        ws.push(n);
                    } else if (n.hasChildNodes()) {
                        findWhite(n);
                    }
                }
            };
            findWhite(node);
            for (var i = 0; i < ws.length; i++) {
                ws[i].parentNode.removeChild(ws[i]);
            }
        };
        var sty = function sty(n, prop) {
            // 获取节点的style
            if (n.style[prop]) {
                return n.style[prop];
            }
            var s = n.currentStyle || n.ownerDocument.defaultView.getComputedStyle(n, null);
            if (n.tagName == "SCRIPT") {
                return "none";
            }
            if (!s[prop]) {
                return "LI,P,TR".indexOf(n.tagName) > -1 ? "block" : n.style[prop];
            }
            if (s[prop] == "block" && n.tagName == "TD") {
                return "feaux-inline";
            }
            return s[prop];
        };

        var blockTypeNodes = "table-row,block,list-item";
        var isBlock = function isBlock(n) {
            // 判断是否为block元素
            var s = sty(n, "display") || "feaux-inline";
            return blockTypeNodes.indexOf(s) > -1;
        };
        // 遍历所有子节点，收集文本内容，注意需要空格和换行
        var recurse = function recurse(n) {
            // 处理pre元素
            if (/pre/.test(sty(n, "whiteSpace"))) {
                t += n.innerHTML.replace(/\t/g, " ");
                return "";
            }
            var s = sty(n, "display");
            if (s == "none") {
                return "";
            }
            var gap = isBlock(n) ? "\n" : " ";
            t += gap;
            for (var i = 0; i < n.childNodes.length; i++) {
                var c = n.childNodes[i];
                if (c.nodeType == 3) {
                    t += c.nodeValue;
                }

                if (c.childNodes.length) {
                    recurse(c);
                }
            }
            t += gap;
            return t;
        };

        var node = ele.cloneNode(true);
        // br转换成会忽略换行, 会出现 <span>aaa</span><br><span>bbb</span> 的情况，因此用一个特殊字符代替，而不是直接替换成 \n
        node.innerHTML = node.innerHTML.replace(/<br[\/]?>/gi, 'NEWLINE');

        // p元素会多一个换行，暂时用NEWLINE进行占位，markdown中不考虑p元素
        //var paras = node.getElementsByTagName('p');
        //for(var i = 0; i < paras.length; i++) {
        //    paras[i].innerHTML += 'NEWLINE';
        //}
        removeWhiteSpace(node);
        return normalize(recurse(node));
    },

    /**
     * 对markdown的html内容进行预处理，已显示图片，todoList等等
     * @param dom 传入的dom对象
     */
    markdownPreProcess: function markdownPreProcess(dom) {
        function htmlUnEncode(input) {
            return String(input).replace(/\&amp;/g, '&').replace(/\&gt;/g, '>').replace(/\&lt;/g, '<').replace(/\&quot;/g, '"').replace(/\&&#39;/g, "'");
        }

        var el = $(dom);
        //处理 table 容器
        el.find('.' + _const2['default'].CLASS.TABLE_CONTAINER).each(function (index) {
            var target = $(this);
            var span = $("<span></span>");
            span.text(htmlUnEncode(target[0].outerHTML));
            span.insertAfter(target);
            var br = $('<br/>');
            br.insertAfter(target);
            target.remove();
        });
        //处理 旧版本 todolist
        el.find('label.wiz-todo-label').each(function (index) {
            var target = $(this);
            //检测如果是遗留的 label 则不进行特殊处理
            var img = $('.wiz-todo-img', this);
            if (img.length === 0) {
                return;
            }

            var span = $("<span></span>");
            //避免 父节点是 body 时导致笔记阅读异常
            span.text(htmlUnEncode(target[0].outerHTML));
            span.insertAfter(target);
            target.remove();
        });
        //处理 todolist
        el.find('.wiz-todo-layer').each(function (index) {
            var target = $(this);
            //检测如果是遗留的 todoList 则不进行特殊处理
            var checkbox = $('.wiz-todo-checkbox', this);
            if (checkbox.length === 0) {
                return;
            }

            var span = $("<span></span>");
            //避免 父节点是 body 时导致笔记阅读异常
            span.text(htmlUnEncode(target[0].outerHTML));
            span.insertAfter(target);
            target.remove();
        });
        //处理 img
        el.find('img').each(function (index) {
            var target = $(this);
            var span = $("<span></span>");
            span.text(htmlUnEncode(target[0].outerHTML));
            span.insertAfter(target);
            target.remove();
        });
        //处理 a 超链接
        el.find('a').each(function (index, link) {
            var linkObj = $(link);
            var href = linkObj.attr('href');
            if (href && /^(wiz|wiznote):/.test(href)) {
                var span = $("<span></span>");
                span.text(htmlUnEncode(linkObj[0].outerHTML));
                span.insertAfter(linkObj);
                linkObj.remove();
            }
        });
        //处理段落 p
        el.find('p').each(function () {
            var target = $(this);
            target.replaceWith($('<div>' + this.innerHTML + '</div>'));
        });
    }
    //-------------------- 以上内容修改需要 保证与 wizUI 中的 utils 内 对应方法一致 end ----------------------
};

exports['default'] = utils;
module.exports = exports['default'];

},{"./const":13}],20:[function(require,module,exports){
/**
 * 默认的样式集合
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _env = require('./env');

var _env2 = _interopRequireDefault(_env);

var _const = require('./const');

var _const2 = _interopRequireDefault(_const);

var TodoStyleMap = {};

var ImgFile = {
    todoChecked: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyJpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNiAoV2luZG93cykiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6RjY1OTU4MUZCRjk3MTFFM0JENDdFMDk4NDNCMkZDMTQiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6RjY1OTU4MjBCRjk3MTFFM0JENDdFMDk4NDNCMkZDMTQiPiA8eG1wTU06RGVyaXZlZEZyb20gc3RSZWY6aW5zdGFuY2VJRD0ieG1wLmlpZDpGNjU5NTgxREJGOTcxMUUzQkQ0N0UwOTg0M0IyRkMxNCIgc3RSZWY6ZG9jdW1lbnRJRD0ieG1wLmRpZDpGNjU5NTgxRUJGOTcxMUUzQkQ0N0UwOTg0M0IyRkMxNCIvPiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PqkphX0AAAJZSURBVHjaYvz//z/DQAImhgEGLNu2bYNzCj+7jpgQaAdiUNz/Z4EKqAJxRz/vbhcgzUeBwSBDE4AhuQiPh6cCcQY8CoBYHYhPALEAFXxWiMdyViCeD8TRSGLdIAe0QS3/BcSlQLwEaMg7Kgc5BxCvAmJfJLGlQFwOcoALVKAMaPEkGsQ3LxBvBGJHJLF9QJwESwOwOF9MA8uFgRiUzcyQxM4AcRA0xBlYkCSoHeySQLwbiLWRxO4AsRcQf0ROhLQAikC8B4iVkMReA7EnlCZYDtQDcT+Z5QTIx0fQLP8CTYB3MEpCHJY3QNlyQBwDxN+JtNwEiHdA4x4GQHHtD8QniS0JxZHYoMSyF4hFiLDcAZq6hdEKpiSoONFFcS6aBksgPgbEKngs94Gmdl408SpofiepLvgL9TlyfIGK6uNAbIFFfSQQrwNiTjTxLlDxjiwALOoZia2MPkJT7EckMRFoyAQhiYHK9CXQYpYBrZSrwGJuPym14R2oZX+RxEC+XA3E+aBiFIinYTEDXsqh+b4Vqo9gLkA3LBdqEbKjJ+BQfxq5lMOSHshqD0yHYkIAFGLeaNFGtQZJLr6shKuUo6YDsOUMGPiMq5SjdpMMW84AxXUArlKOFm1C5JxBsJQjqlVMhh5YzuAnVMrRygEMROYKogDj1q1bYQUGI42b4ij2eHl5YaQBIRpaLoQvEX6CsmNp6IAUpIYJhgP2INVeeUAsSEWLBaFmNkP5u7A5oBqIPwAxGxBPhDZO/1MJv4OayQa1oxqbA25A6/l10FKN2uAz1GwLqF0oACDAAGu/mbMal6iXAAAAAElFTkSuQmCC',
    todoUnChecked: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyJpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNiAoV2luZG93cykiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6RDcyODY1Q0NCRjk2MTFFMzhGNTBEODZBNTIzNzhDQjQiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6RDcyODY1Q0RCRjk2MTFFMzhGNTBEODZBNTIzNzhDQjQiPiA8eG1wTU06RGVyaXZlZEZyb20gc3RSZWY6aW5zdGFuY2VJRD0ieG1wLmlpZDpENzI4NjVDQUJGOTYxMUUzOEY1MEQ4NkE1MjM3OENCNCIgc3RSZWY6ZG9jdW1lbnRJRD0ieG1wLmRpZDpENzI4NjVDQkJGOTYxMUUzOEY1MEQ4NkE1MjM3OENCNCIvPiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PpXYwTEAAAD5SURBVHjaYvz//z/DQAImhgEGA+4Alm3bttHdUi8vL4wQUAXitUD8EYj/Uxl/hJqtijUEgFgdiE8AsQCNPMwHxEFA7ATEFkB8Ez0NtEEt/wXE+UAsDMSMVMJCUDN/Qe1owxYCLlB2GRBPorLv30PN5ATiDiB2w5YL+KDsxTRMd7OhNA++bPiOhg54N1oQjTpg1AGjDhh1wKgDRh0w6oAh4QAhGtojhM8Bn6DsWBo6IAVKf8HmgD1QdhcQ5wGxIBUtFoSa2Qzl78LmgGog/gDEbEA8EdqApFav6B3UTDaoHdXYHHAD2mNZB8SfaRD8n6FmW0DtQgEAAQYAS2BO8CD/bL4AAAAASUVORK5CYII='
};

var TmpEditorStyle = {
    phone: 'body {' + 'overflow-y:scroll;' + '-webkit-overflow-scrolling: touch;' + '-webkit-tap-highlight-color: rgba(0, 0, 0, 0);' + '}' + 'td,th {position:static;}' + 'th:before,td:before,th:after,td:after {display:none;}',
    pad: 'body {' + 'min-width: 90%;' + 'max-width: 100%;' + 'min-height: 100%;' + 'background: #ffffff;' + 'overflow-y:scroll;' + '-webkit-overflow-scrolling: touch;' + '-webkit-tap-highlight-color: rgba(0, 0, 0, 0);' + '}' + 'td,th {position:static;}' + 'th:before,td:before,th:after,td:after {display:none;}'
},
    TmpReaderStyle = {
    phone: 'img {' + 'max-width: 100%;' + 'height: auto !important;' + 'margin: 0px auto;' + 'cursor: pointer;' + //专门用于 ios 点击 img 触发 click 事件
    '}' + 'a {' + 'word-wrap: break-word;' + '}' + 'body {' + 'word-wrap: break-word;' + '}'
},
    DefaultFont = 'Helvetica, "Hiragino Sans GB", "微软雅黑", "Microsoft YaHei UI", SimSun, SimHei, arial, sans-serif;',
    DefaultStyle = {
    common: 'html, body {' + 'font-size: 15px;' + '}' + 'body {' + 'font-family: ' + DefaultFont + 'line-height: 1.6;' + 'margin: 0;padding: 20px 15px;padding: 1.33rem 1rem;' + '}' + 'h1, h2, h3, h4, h5, h6 {margin:20px 0 10px;margin:1.33rem 0 0.667rem;padding: 0;font-weight: bold;}' + 'h1 {font-size:21px;font-size:1.4rem;}' + 'h2 {font-size:20px;font-size:1.33rem;}' + 'h3 {font-size:18px;font-size:1.2rem;}' + 'h4 {font-size:17px;font-size:1.13rem;}' + 'h5 {font-size:15px;font-size:1rem;}' + 'h6 {font-size:15px;font-size:1rem;color: #777777;margin: 1rem 0;}' + 'div, p, ul, ol, dl, li {margin:0;}' + 'blockquote, table, pre, code {margin:8px 0;}' + 'ul, ol {padding-left:32px;padding-left:2.13rem;}' + 'blockquote {padding:0 12px;padding:0 0.8rem;}' + 'blockquote > :first-child {margin-top:0;}' + 'blockquote > :last-child {margin-bottom:0;}' + 'img {border:0;max-width:100%;height:auto !important;margin:2px 0;}' + 'table {border-collapse:collapse;border:1px solid #bbbbbb;}' + 'td, th {padding:4px 8px;border-collapse:collapse;border:1px solid #bbbbbb;height:28px;word-break:break-all;box-sizing: border-box;}' + '@media only screen and (-webkit-max-device-width: 1024px), only screen and (-o-max-device-width: 1024px), only screen and (max-device-width: 1024px), only screen and (-webkit-min-device-pixel-ratio: 3), only screen and (-o-min-device-pixel-ratio: 3), only screen and (min-device-pixel-ratio: 3) {' + 'html,body {font-size:17px;}' + 'body {line-height:1.7;padding:0.75rem 0.9375rem;color:#353c47;}' + 'h1 {font-size:2.125rem;}' + 'h2 {font-size:1.875rem;}' + 'h3 {font-size:1.625rem;}' + 'h4 {font-size:1.375rem;}' + 'h5 {font-size:1.125rem;}' + 'h6 {color: inherit;}' + 'ul, ol {padding-left:2.5rem;}' + 'blockquote {padding:0 0.9375rem;}' + '}',
    todoList: '.wiz-todo-main {padding-left: 12px;position: relative;line-height:30px;/*display: inline-block; padding-top: 7px; padding-bottom: 6px;*/}' + '.wiz-todo-checked { /*text-decoration: line-through;*/ color: #666;}' + '.wiz-todo-unchecked {text-decoration: initial;}' + '.wiz-todo-checked .wiz-todo-checkbox {background-image:url(' + ImgFile.todoChecked + ')}' + '.wiz-todo-unchecked .wiz-todo-checkbox {background-image:url(' + ImgFile.todoUnChecked + ')}' + '.wiz-todo-checkbox {border:0;background-color:transparent;outline:none;width:16px !important; height:16px !important; cursor:default; padding:0 10px 0 0;-webkit-user-select: none; background-size:16px;background-repeat:no-repeat;}' + '.wiz-todo-completed-info {padding-left: 44px;}' + '.wiz-todo-avatar {border:0;background-color:transparent;outline:none;width:20px !important; height: 20px !important; vertical-align: -20%; padding:0; margin:0 10px 0 0; border-radius:100%;background-size:20px;background-repeat:no-repeat;}' +
    //单独出来主要为了兼容旧的 todoList
    'input.wiz-todo-avatar {position:relative;top:-4px;}' + '.wiz-todo-account, .wiz-todo-dt { color: #666; }'
},
    ImageResizeStyle = '.wiz-img-resize-handle {position: absolute;z-index: 1000;border: 1px solid black;background-color: white;}' + '.wiz-img-resize-handle {width:5px;height:5px;}' + '.wiz-img-resize-handle.lt {cursor: nw-resize;}' + '.wiz-img-resize-handle.tm {cursor: n-resize;}' + '.wiz-img-resize-handle.rt {cursor: ne-resize;}' + '.wiz-img-resize-handle.lm {cursor: w-resize;}' + '.wiz-img-resize-handle.rm {cursor: e-resize;}' + '.wiz-img-resize-handle.lb {cursor: sw-resize;}' + '.wiz-img-resize-handle.bm {cursor: s-resize;}' + '.wiz-img-resize-handle.rb {cursor: se-resize;}',
    TableContainerStyle = '.' + _const2['default'].CLASS.TABLE_CONTAINER + ' {}' + '.' + _const2['default'].CLASS.TABLE_BODY + ' {position:relative;padding:0 0 10px;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;}' + '.' + _const2['default'].CLASS.TABLE_BODY + ' table {margin:0;outline:none;}' + 'td,th {height:28px;word-break:break-all;box-sizing:border-box;outline:none;}',
    TableEditStyle = '.' + _const2['default'].CLASS.TABLE_BODY + '.' + _const2['default'].CLASS.TABLE_MOVING + ' *,' + ' .' + _const2['default'].CLASS.TABLE_BODY + '.' + _const2['default'].CLASS.TABLE_MOVING + ' *:before,' + ' .' + _const2['default'].CLASS.TABLE_BODY + '.' + _const2['default'].CLASS.TABLE_MOVING + ' *:after {cursor:default !important;}' + 'td,th {position:relative;}' + '#wiz-table-range-border {display: none;width: 0;height: 0;position: absolute;top: 0;left: 0; z-index:' + _const2['default'].CSS.Z_INDEX.tableBorder + '}' + '#wiz-table-col-line, #wiz-table-row-line {display: none;background-color: #448aff;position: absolute;z-index:' + _const2['default'].CSS.Z_INDEX.tableColRowLine + ';}' + '#wiz-table-col-line {width: 1px;cursor:col-resize;}' + '#wiz-table-row-line {height: 1px;cursor:row-resize;}' + '#wiz-table-range-border_start, #wiz-table-range-border_range {display: none;width: 0;height: 0;position: absolute;}' + '#wiz-table-range-border_start_top, #wiz-table-range-border_range_top {height: 2px;background-color: #448aff;position: absolute;top: 0;left: 0;}' + '#wiz-table-range-border_range_top {height: 1px;}' + '#wiz-table-range-border_start_right, #wiz-table-range-border_range_right {width: 2px;background-color: #448aff;position: absolute;top: 0;}' + '#wiz-table-range-border_range_right {width: 1px;}' + '#wiz-table-range-border_start_bottom, #wiz-table-range-border_range_bottom {height: 2px;background-color: #448aff;position: absolute;top: 0;}' + '#wiz-table-range-border_range_bottom {height: 1px;}' + '#wiz-table-range-border_start_left, #wiz-table-range-border_range_left {width: 2px;background-color: #448aff;position: absolute;top: 0;left: 0;}' + '#wiz-table-range-border_range_left {width: 1px;}' + '#wiz-table-range-border_start_dot, #wiz-table-range-border_range_dot {width: 5px;height: 5px;border: 2px solid rgb(255, 255, 255);background-color: #448aff;cursor: crosshair;position: absolute;z-index:' + _const2['default'].CSS.Z_INDEX.tableRangeDot + ';}' + '.wiz-table-tools {display: block;background-color:#fff;position: absolute;left: 0px;border: 1px solid #ddd;-webkit-border-radius: 5px;-moz-border-radius: 5px;border-radius: 5px;z-index:' + _const2['default'].CSS.Z_INDEX.tableTools + ';}' + '.wiz-table-tools ul {list-style: none;padding: 0;}' + '.wiz-table-tools .wiz-table-menu-item {position: relative;float: left;margin:5px 2px 5px 8px;}' + '.wiz-table-tools .wiz-table-menu-item .wiz-table-menu-button {width: 20px;height: 20px;cursor: pointer;position:relative;}' + '.wiz-table-tools i.editor-icon{font-size: 15px;color: #455a64;}' + '.wiz-table-tools .wiz-table-menu-item .wiz-table-menu-button i#wiz-menu-bg-demo{position: absolute;top:3px;left:0;}' + '.wiz-table-tools .wiz-table-menu-sub {position: absolute;display: none;width: 125px;padding: 5px 0;background: #fff;border-radius: 3px;border: 1px solid #E0E0E0;top:28px;left:-9px;box-shadow: 1px 1px 5px #d0d0d0;}' + '.wiz-table-tools .wiz-table-menu-item.active .wiz-table-menu-sub {display: block}' + '.wiz-table-tools .wiz-table-menu-sub:before, .wiz-table-tools .wiz-table-menu-sub:after {position: absolute;content: " ";border-style: solid;border-color: transparent;border-bottom-color: #cccccc;left: 22px;margin-left: -14px;top: -8px;border-width: 0 8px 8px 8px;z-index:' + _const2['default'].CSS.Z_INDEX.tableToolsArrow + ';}' + '.wiz-table-tools .wiz-table-menu-sub:after {border-bottom-color: #ffffff;top: -7px;}' + '.wiz-table-tools .wiz-table-menu-sub-item {padding: 4px 12px;font-size: 14px;}' + '.wiz-table-tools .wiz-table-menu-sub-item.split {border-top: 1px solid #E0E0E0;}' + '.wiz-table-tools .wiz-table-menu-sub-item:hover {background-color: #ececec;}' + '.wiz-table-tools .wiz-table-menu-sub-item.disabled {color: #bbbbbb;cursor: default;}' + '.wiz-table-tools .wiz-table-menu-sub-item.disabled:hover {background-color: transparent;}' + '.wiz-table-tools .wiz-table-menu-item.wiz-table-cell-bg:hover .wiz-table-color-pad {display: block;}' + '.wiz-table-tools .wiz-table-color-pad {display: none;padding: 10px;box-sizing: border-box;width: 85px;height: 88px;background-color: #fff;cursor: default;}' + '.wiz-table-tools .wiz-table-color-pad .wiz-table-color-pad-item {display: inline-block;width: 15px;height: 15px;margin-right: 9px;position: relative;}' + '.wiz-table-tools .wiz-table-color-pad .wiz-table-color-pad-item i.pad-demo {position: absolute;top:3px;left:0;}' + '.wiz-table-tools .wiz-table-color-pad .wiz-table-color-pad-item .icon-oblique_line{color: #cc0000;}' + '.wiz-table-tools .wiz-table-color-pad .wiz-table-color-pad-item:last-child {margin-right: 0;}' + '.wiz-table-tools .wiz-table-color-pad .wiz-table-color-pad-item.active i.editor-icon.icon-box {color: #448aff;}' + '.wiz-table-tools .wiz-table-cell-align {display: none;padding: 10px;box-sizing: border-box;width: 85px;height: 65px;background-color: #fff;cursor: default;}' + '.wiz-table-tools .wiz-table-cell-align .wiz-table-cell-align-item {display: inline-block;width: 15px;height: 15px;margin-right: 9px;position: relative;}' + '.wiz-table-tools .wiz-table-cell-align .wiz-table-cell-align-item:last-child {margin-right:0}' + '.wiz-table-tools .wiz-table-cell-align .wiz-table-cell-align-item i.valign{position: absolute;top:3px;left:0;color: #d2d2d2;}' + '.wiz-table-tools .wiz-table-cell-align-item.active i.editor-icon.valign {color: #a1c4ff;}' + '.wiz-table-tools .wiz-table-cell-align-item.active i.editor-icon.icon-box,' + '.wiz-table-tools .wiz-table-cell-align-item.active i.editor-icon.align {color: #448aff;}' + '.wiz-table-tools .wiz-table-color-pad .wiz-table-color-pad-item:last-child,' + '.wiz-table-tools .wiz-table-cell-align .wiz-table-cell-align-item:last-child {margin-right: 0;}' + 'th.wiz-selected-cell, td.wiz-selected-cell {background: rgba(0,102,255,.05);}' + 'th:before,td:before,#wiz-table-col-line:before,#wiz-table-range-border_start_right:before,#wiz-table-range-border_range_right:before{content: " ";position: absolute;top: 0;bottom: 0;right: -5px;width: 9px;cursor: col-resize;background: transparent;z-index:' + _const2['default'].CSS.Z_INDEX.tableTDBefore + ';}' + 'th:after,td:after,#wiz-table-row-line:before,#wiz-table-range-border_start_bottom:before,#wiz-table-range-border_range_bottom:before{content: " ";position: absolute;left: 0;right: 0;bottom: -5px;height: 9px;cursor: row-resize;background: transparent;z-index:' + _const2['default'].CSS.Z_INDEX.tableTDBefore + ';}';

function replaceStyleById(id, css, isReplace) {
    //isReplace = true 则 只进行替换， 如无同id 的元素，不进行任何操作
    isReplace = !!isReplace;

    var s = _env2['default'].doc.getElementById(id);
    if (!s && !isReplace) {
        s = _env2['default'].doc.createElement('style');
        s.id = id;
        _env2['default'].doc.getElementsByTagName('HEAD')[0].insertBefore(s, null);
    }
    if (s) {
        s.innerHTML = css;
    }
}

var WizStyle = {
    insertDefaultStyle: function insertDefaultStyle(isReplace, customCss) {
        replaceStyleById(_const2['default'].ID.WIZ_DEFAULT_STYLE, DefaultStyle.common, isReplace);
        if (!customCss) {
            return;
        }
        var css,
            k,
            hasCustomCss = false;
        if (typeof customCss == 'string') {
            css = customCss;
            hasCustomCss = true;
        } else {
            css = 'html, body{';
            for (k in customCss) {
                if (customCss.hasOwnProperty(k)) {
                    if (k.toLowerCase() == 'font-family') {
                        css += k + ':' + customCss[k] + ',' + DefaultFont + ';';
                    } else {
                        css += k + ':' + customCss[k] + ';';
                    }
                    hasCustomCss = true;
                }
            }
            css += '}';
        }

        if (hasCustomCss) {
            WizStyle.insertStyle({ name: _const2['default'].NAME.TMP_STYLE }, css);
        }
    },
    insertStyle: function insertStyle(options, css) {
        var s = _env2['default'].doc.createElement('style');
        if (options.name) {
            s.setAttribute('name', options.name);
        }
        if (options.id) {
            s.setAttribute('id', options.id);
        }
        _env2['default'].doc.getElementsByTagName('HEAD')[0].insertBefore(s, null);
        s.innerHTML = css;
        return s;
    },
    insertTmpEditorStyle: function insertTmpEditorStyle() {
        WizStyle.insertStyle({ name: _const2['default'].NAME.TMP_STYLE }, ImageResizeStyle + TableEditStyle + TableContainerStyle);

        if (_env2['default'].client.type.isIOS && _env2['default'].client.type.isPhone) {
            WizStyle.insertStyle({ name: _const2['default'].NAME.TMP_STYLE }, TmpEditorStyle.phone);
        } else if (_env2['default'].client.type.isIOS && _env2['default'].client.type.isPad) {
            WizStyle.insertStyle({ name: _const2['default'].NAME.TMP_STYLE }, TmpEditorStyle.pad);
        }
    },
    insertTmpReaderStyle: function insertTmpReaderStyle() {
        WizStyle.insertStyle({ name: _const2['default'].NAME.TMP_STYLE }, TableContainerStyle);
        if (_env2['default'].client.type.isIOS) {
            WizStyle.insertStyle({ name: _const2['default'].NAME.TMP_STYLE }, TmpReaderStyle.phone);
        }
    },
    insertTodoStyle: function insertTodoStyle(isForced) {
        WizStyle.removeTodoOldStyle();
        var s = _env2['default'].doc.getElementById(_const2['default'].ID.TODO_STYLE);
        if (isForced || !s) {
            replaceStyleById(_const2['default'].ID.TODO_STYLE, DefaultStyle.todoList, false);
        }
        WizStyle.removeUnUsedTodoStyle();
    },
    removeTodoOldStyle: function removeTodoOldStyle() {
        var style = _env2['default'].doc.getElementById(_const2['default'].ID.TODO_STYLE_OLD);
        if (style) {
            style.parentNode.removeChild(style);
        }
    },
    removeTodoStyle: function removeTodoStyle() {
        WizStyle.removeTodoOldStyle();
        var style = _env2['default'].doc.getElementById(_const2['default'].ID.TODO_STYLE);
        if (style) {
            style.parentNode.removeChild(style);
        }

        var styleList = _env2['default'].doc.querySelectorAll('style'),
            guid,
            i;
        for (i = styleList.length - 1; i >= 0; i--) {
            style = styleList[i];
            if (style.id && style.id.indexOf(_const2['default'].ID.TODO_AVATAR_STYLE) === 0) {
                guid = getGuidFromStyleId(style.id);
                TodoStyleMap[guid] = style.innerHTML;
                style.parentNode.removeChild(style);
            }
        }
    },
    removeUnUsedTodoStyle: function removeUnUsedTodoStyle(guid) {
        var styleList = _env2['default'].doc.querySelectorAll('style'),
            style,
            sId,
            sClass,
            userAvatar,
            i;

        if (guid) {
            sId = _const2['default'].ID.TODO_AVATAR_STYLE + guid;
            sClass = _const2['default'].CLASS.TODO_USER_AVATAR + guid;
            userAvatar = _env2['default'].doc.querySelector('.' + sClass);
            style = _env2['default'].doc.getElementById(sId);
            if (style && !userAvatar) {
                TodoStyleMap[guid] = style.innerHTML;
                style.parentNode.removeChild(style);
            }
            return;
        }

        for (i = styleList.length - 1; i >= 0; i--) {
            style = styleList[i];
            sId = style.id;
            if (sId && sId.indexOf(_const2['default'].ID.TODO_AVATAR_STYLE) === 0) {
                guid = getGuidFromStyleId(sId);
                if (!_env2['default'].doc.querySelector('.' + _const2['default'].CLASS.TODO_USER_AVATAR + guid)) {
                    TodoStyleMap[guid] = style.innerHTML;
                    style.parentNode.removeChild(style);
                }
            }
        }
    },
    /**
     * 专门用于 redo / undo 操作时，恢复 avatar 样式处理
     */
    restoreUserAvatarStyle: function restoreUserAvatarStyle() {
        var guid, styleId;
        for (guid in TodoStyleMap) {
            if (TodoStyleMap.hasOwnProperty(guid)) {
                styleId = _const2['default'].ID.TODO_AVATAR_STYLE + guid;
                if (!_env2['default'].doc.querySelector('#' + styleId) && _env2['default'].doc.querySelector('.' + _const2['default'].CLASS.TODO_USER_AVATAR + guid)) {
                    replaceStyleById(styleId, TodoStyleMap[guid], false);
                }
            }
        }
    }
};

function getGuidFromStyleId(styleId) {
    var guidReg = new RegExp('^' + _const2['default'].ID.TODO_AVATAR_STYLE + '(.*)$', 'i');
    return styleId.replace(guidReg, '$1');
}

exports['default'] = WizStyle;
module.exports = exports['default'];

},{"./const":13,"./env":15}],21:[function(require,module,exports){
/**
 * 专门用于记录用户行为的 log
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var ActionId = {
    ClickAcceptFromAmendInfo: 'ClickAcceptFromAmendInfo',
    ClickRefuseFromAmendInfo: 'ClickRefuseFromAmendInfo'
};

var wizUserAction = {
    save: function save(id) {
        if (_commonEnv2['default'].client.type.isWin) {
            try {
                if (external && external.LogAction) {
                    external.LogAction(id);
                }
            } catch (e) {
                console.log(e.toString());
            }
        }
    }
};

var UserAction = {
    ActionId: ActionId,
    save: wizUserAction.save
};

exports['default'] = UserAction;
module.exports = exports['default'];

},{"../common/env":15}],22:[function(require,module,exports){
/**
 * 兼容 ES6 将 require 替换为 _require
 */
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
(function e(t, n, r) {
  function s(o, u) {
    if (!n[o]) {
      if (!t[o]) {
        var a = typeof _require == "function" && _require;if (!u && a) return a(o, !0);if (i) return i(o, !0);var f = new Error("Cannot find module '" + o + "'");throw (f.code = "MODULE_NOT_FOUND", f);
      }var l = n[o] = { exports: {} };t[o][0].call(l.exports, function (e) {
        var n = t[o][1][e];return s(n ? n : e);
      }, l, l.exports, e, t, n, r);
    }return n[o].exports;
  }var i = typeof _require == "function" && _require;for (var o = 0; o < r.length; o++) s(r[o]);return s;
})({ 1: [function (_require, module, exports) {
    /**
     * 默认配置
     *
     * @author 老雷<leizongmin@gmail.com>
     */

    var FilterCSS = _require('cssfilter').FilterCSS;
    var _ = _require('./util');

    // 默认白名单
    function getDefaultWhiteList() {
      return {
        a: ['target', 'href', 'title'],
        abbr: ['title'],
        address: [],
        area: ['shape', 'coords', 'href', 'alt'],
        article: [],
        aside: [],
        audio: ['autoplay', 'controls', 'loop', 'preload', 'src'],
        b: [],
        bdi: ['dir'],
        bdo: ['dir'],
        big: [],
        blockquote: ['cite'],
        br: [],
        caption: [],
        center: [],
        cite: [],
        code: [],
        col: ['align', 'valign', 'span', 'width'],
        colgroup: ['align', 'valign', 'span', 'width'],
        dd: [],
        del: ['datetime'],
        details: ['open'],
        div: [],
        dl: [],
        dt: [],
        em: [],
        font: ['color', 'size', 'face'],
        footer: [],
        h1: [],
        h2: [],
        h3: [],
        h4: [],
        h5: [],
        h6: [],
        header: [],
        hr: [],
        i: [],
        img: ['src', 'alt', 'title', 'width', 'height'],
        ins: ['datetime'],
        li: [],
        mark: [],
        nav: [],
        ol: [],
        p: [],
        pre: [],
        s: [],
        section: [],
        small: [],
        span: [],
        sub: [],
        sup: [],
        strong: [],
        table: ['width', 'border', 'align', 'valign'],
        tbody: ['align', 'valign'],
        td: ['width', 'rowspan', 'colspan', 'align', 'valign'],
        tfoot: ['align', 'valign'],
        th: ['width', 'rowspan', 'colspan', 'align', 'valign'],
        thead: ['align', 'valign'],
        tr: ['rowspan', 'align', 'valign'],
        tt: [],
        u: [],
        ul: [],
        video: ['autoplay', 'controls', 'loop', 'preload', 'src', 'height', 'width']
      };
    }

    // 默认CSS Filter
    var defaultCSSFilter = new FilterCSS();

    /**
     * 匹配到标签时的处理方法
     *
     * @param {String} tag
     * @param {String} html
     * @param {Object} options
     * @return {String}
     */
    function onTag(tag, html, options) {}
    // do nothing

    /**
     * 匹配到不在白名单上的标签时的处理方法
     *
     * @param {String} tag
     * @param {String} html
     * @param {Object} options
     * @return {String}
     */
    function onIgnoreTag(tag, html, options) {}
    // do nothing

    /**
     * 匹配到标签属性时的处理方法
     *
     * @param {String} tag
     * @param {String} name
     * @param {String} value
     * @return {String}
     */
    function onTagAttr(tag, name, value) {}
    // do nothing

    /**
     * 匹配到不在白名单上的标签属性时的处理方法
     *
     * @param {String} tag
     * @param {String} name
     * @param {String} value
     * @return {String}
     */
    function onIgnoreTagAttr(tag, name, value) {}
    // do nothing

    /**
     * HTML转义
     *
     * @param {String} html
     */
    function escapeHtml(html) {
      return html.replace(REGEXP_LT, '&lt;').replace(REGEXP_GT, '&gt;');
    }

    /**
     * 安全的标签属性值
     *
     * @param {String} tag
     * @param {String} name
     * @param {String} value
     * @param {Object} cssFilter
     * @return {String}
     */
    function safeAttrValue(tag, name, value, cssFilter) {
      cssFilter = cssFilter || defaultCSSFilter;
      // 转换为友好的属性值，再做判断
      value = friendlyAttrValue(value);

      if (name === 'href' || name === 'src') {
        // 过滤 href 和 src 属性
        // 仅允许 http:// | https:// | mailto: | / | # 开头的地址
        value = _.trim(value);
        if (value === '#') return '#';
        if (!(value.substr(0, 7) === 'http://' || value.substr(0, 8) === 'https://' || value.substr(0, 7) === 'mailto:' || value[0] === '#' || value[0] === '/')) {
          return '';
        }
      } else if (name === 'background') {
        // 过滤 background 属性 （这个xss漏洞较老了，可能已经不适用）
        // javascript:
        REGEXP_DEFAULT_ON_TAG_ATTR_4.lastIndex = 0;
        if (REGEXP_DEFAULT_ON_TAG_ATTR_4.test(value)) {
          return '';
        }
      } else if (name === 'style') {
        // /*注释*/
        /*REGEXP_DEFAULT_ON_TAG_ATTR_3.lastIndex = 0;
         if (REGEXP_DEFAULT_ON_TAG_ATTR_3.test(value)) {
         return '';
         }*/
        // expression()
        REGEXP_DEFAULT_ON_TAG_ATTR_7.lastIndex = 0;
        if (REGEXP_DEFAULT_ON_TAG_ATTR_7.test(value)) {
          return '';
        }
        // url()
        REGEXP_DEFAULT_ON_TAG_ATTR_8.lastIndex = 0;
        if (REGEXP_DEFAULT_ON_TAG_ATTR_8.test(value)) {
          REGEXP_DEFAULT_ON_TAG_ATTR_4.lastIndex = 0;
          if (REGEXP_DEFAULT_ON_TAG_ATTR_4.test(value)) {
            return '';
          }
        }
        value = cssFilter.process(value);
      }

      // 输出时需要转义<>"
      value = escapeAttrValue(value);
      return value;
    }

    // 正则表达式
    var REGEXP_LT = /</g;
    var REGEXP_GT = />/g;
    var REGEXP_QUOTE = /"/g;
    var REGEXP_QUOTE_2 = /&quot;/g;
    var REGEXP_ATTR_VALUE_1 = /&#([a-zA-Z0-9]*);?/img;
    var REGEXP_ATTR_VALUE_COLON = /&colon;?/img;
    var REGEXP_ATTR_VALUE_NEWLINE = /&newline;?/img;
    var REGEXP_DEFAULT_ON_TAG_ATTR_3 = /\/\*|\*\//mg;
    var REGEXP_DEFAULT_ON_TAG_ATTR_4 = /((j\s*a\s*v\s*a|v\s*b|l\s*i\s*v\s*e)\s*s\s*c\s*r\s*i\s*p\s*t\s*|m\s*o\s*c\s*h\s*a)\:/ig;
    var REGEXP_DEFAULT_ON_TAG_ATTR_5 = /^[\s"'`]*(d\s*a\s*t\s*a\s*)\:/ig;
    var REGEXP_DEFAULT_ON_TAG_ATTR_6 = /^[\s"'`]*(d\s*a\s*t\s*a\s*)\:\s*image\//ig;
    var REGEXP_DEFAULT_ON_TAG_ATTR_7 = /e\s*x\s*p\s*r\s*e\s*s\s*s\s*i\s*o\s*n\s*\(.*/ig;
    var REGEXP_DEFAULT_ON_TAG_ATTR_8 = /u\s*r\s*l\s*\(.*/ig;

    /**
     * 对双引号进行转义
     *
     * @param {String} str
     * @return {String} str
     */
    function escapeQuote(str) {
      return str.replace(REGEXP_QUOTE, '&quot;');
    }

    /**
     * 对双引号进行转义
     *
     * @param {String} str
     * @return {String} str
     */
    function unescapeQuote(str) {
      return str.replace(REGEXP_QUOTE_2, '"');
    }

    /**
     * 对html实体编码进行转义
     *
     * @param {String} str
     * @return {String}
     */
    function escapeHtmlEntities(str) {
      return str.replace(REGEXP_ATTR_VALUE_1, function replaceUnicode(str, code) {
        return code[0] === 'x' || code[0] === 'X' ? String.fromCharCode(parseInt(code.substr(1), 16)) : String.fromCharCode(parseInt(code, 10));
      });
    }

    /**
     * 对html5新增的危险实体编码进行转义
     *
     * @param {String} str
     * @return {String}
     */
    function escapeDangerHtml5Entities(str) {
      return str.replace(REGEXP_ATTR_VALUE_COLON, ':').replace(REGEXP_ATTR_VALUE_NEWLINE, ' ');
    }

    /**
     * 清除不可见字符
     *
     * @param {String} str
     * @return {String}
     */
    function clearNonPrintableCharacter(str) {
      var str2 = '';
      for (var i = 0, len = str.length; i < len; i++) {
        str2 += str.charCodeAt(i) < 32 ? ' ' : str.charAt(i);
      }
      return _.trim(str2);
    }

    /**
     * 将标签的属性值转换成一般字符，便于分析
     *
     * @param {String} str
     * @return {String}
     */
    function friendlyAttrValue(str) {
      str = unescapeQuote(str); // 双引号
      str = escapeHtmlEntities(str); // 转换HTML实体编码
      str = escapeDangerHtml5Entities(str); // 转换危险的HTML5新增实体编码
      str = clearNonPrintableCharacter(str); // 清除不可见字符
      return str;
    }

    /**
     * 转义用于输出的标签属性值
     *
     * @param {String} str
     * @return {String}
     */
    function escapeAttrValue(str) {
      str = escapeQuote(str);
      str = escapeHtml(str);
      return str;
    }

    /**
     * 去掉不在白名单中的标签onIgnoreTag处理方法
     */
    function onIgnoreTagStripAll() {
      return '';
    }

    /**
     * 删除标签体
     *
     * @param {array} tags 要删除的标签列表
     * @param {function} next 对不在列表中的标签的处理函数，可选
     */
    function StripTagBody(tags, next) {
      if (typeof next !== 'function') {
        next = function () {};
      }

      var isRemoveAllTag = !Array.isArray(tags);
      function isRemoveTag(tag) {
        if (isRemoveAllTag) return true;
        return _.indexOf(tags, tag) !== -1;
      }

      var removeList = []; // 要删除的位置范围列表
      var posStart = false; // 当前标签开始位置

      return {
        onIgnoreTag: function onIgnoreTag(tag, html, options) {
          if (isRemoveTag(tag)) {
            if (options.isClosing) {
              var ret = '[/removed]';
              var end = options.position + ret.length;
              removeList.push([posStart !== false ? posStart : options.position, end]);
              posStart = false;
              return ret;
            } else {
              if (!posStart) {
                posStart = options.position;
              }
              return '[removed]';
            }
          } else {
            return next(tag, html, options);
          }
        },
        remove: function remove(html) {
          var rethtml = '';
          var lastPos = 0;
          _.forEach(removeList, function (pos) {
            rethtml += html.slice(lastPos, pos[0]);
            lastPos = pos[1];
          });
          rethtml += html.slice(lastPos);
          return rethtml;
        }
      };
    }

    /**
     * 去除备注标签
     *
     * @param {String} html
     * @return {String}
     */
    function stripCommentTag(html) {
      return html.replace(STRIP_COMMENT_TAG_REGEXP, '');
    }
    var STRIP_COMMENT_TAG_REGEXP = /<!--[\s\S]*?-->/g;

    /**
     * 去除不可见字符
     *
     * @param {String} html
     * @return {String}
     */
    function stripBlankChar(html) {
      var chars = html.split('');
      chars = chars.filter(function (char) {
        var c = char.charCodeAt(0);
        if (c === 127) return false;
        if (c <= 31) {
          if (c === 10 || c === 13) return true;
          return false;
        }
        return true;
      });
      return chars.join('');
    }

    exports.whiteList = getDefaultWhiteList();
    exports.getDefaultWhiteList = getDefaultWhiteList;
    exports.onTag = onTag;
    exports.onIgnoreTag = onIgnoreTag;
    exports.onTagAttr = onTagAttr;
    exports.onIgnoreTagAttr = onIgnoreTagAttr;
    exports.safeAttrValue = safeAttrValue;
    exports.escapeHtml = escapeHtml;
    exports.escapeQuote = escapeQuote;
    exports.unescapeQuote = unescapeQuote;
    exports.escapeHtmlEntities = escapeHtmlEntities;
    exports.escapeDangerHtml5Entities = escapeDangerHtml5Entities;
    exports.clearNonPrintableCharacter = clearNonPrintableCharacter;
    exports.friendlyAttrValue = friendlyAttrValue;
    exports.escapeAttrValue = escapeAttrValue;
    exports.onIgnoreTagStripAll = onIgnoreTagStripAll;
    exports.StripTagBody = StripTagBody;
    exports.stripCommentTag = stripCommentTag;
    exports.stripBlankChar = stripBlankChar;
    exports.cssFilter = defaultCSSFilter;
  }, { "./util": 4, "cssfilter": 8 }], 2: [function (_require, module, exports) {
    /**
     * 模块入口
     *
     * @author 老雷<leizongmin@gmail.com>
     */

    var DEFAULT = _require('./default');
    var parser = _require('./parser');
    var FilterXSS = _require('./xss');

    /**
     * XSS过滤
     *
     * @param {String} html 要过滤的HTML代码
     * @param {Object} options 选项：whiteList, onTag, onTagAttr, onIgnoreTag, onIgnoreTagAttr, safeAttrValue, escapeHtml
     * @return {String}
     */
    function filterXSS(html, options) {
      var xss = new FilterXSS(options);
      return xss.process(html);
    }

    // 输出
    exports = module.exports = filterXSS;
    exports.FilterXSS = FilterXSS;
    for (var i in DEFAULT) exports[i] = DEFAULT[i];
    for (var i in parser) exports[i] = parser[i];

    // 在浏览器端使用
    if (typeof window !== 'undefined') {
      window.filterXSS = module.exports;
    }
  }, { "./default": 1, "./parser": 3, "./xss": 5 }], 3: [function (_require, module, exports) {
    /**
     * 简单 HTML Parser
     *
     * @author 老雷<leizongmin@gmail.com>
     */

    var _ = _require('./util');

    /**
     * 获取标签的名称
     *
     * @param {String} html 如：'<a hef="#">'
     * @return {String}
     */
    function getTagName(html) {
      var i = html.indexOf(' ');
      if (i === -1) {
        var tagName = html.slice(1, -1);
      } else {
        var tagName = html.slice(1, i + 1);
      }
      tagName = _.trim(tagName).toLowerCase();
      if (tagName.slice(0, 1) === '/') tagName = tagName.slice(1);
      if (tagName.slice(-1) === '/') tagName = tagName.slice(0, -1);
      return tagName;
    }

    /**
     * 是否为闭合标签
     *
     * @param {String} html 如：'<a hef="#">'
     * @return {Boolean}
     */
    function isClosing(html) {
      return html.slice(0, 2) === '</';
    }

    /**
     * 分析HTML代码，调用相应的函数处理，返回处理后的HTML
     *
     * @param {String} html
     * @param {Function} onTag 处理标签的函数
     *   参数格式： function (sourcePosition, position, tag, html, isClosing)
     * @param {Function} escapeHtml 对HTML进行转义的函数
     * @return {String}
     */
    function parseTag(html, onTag, escapeHtml) {
      'user strict';

      var rethtml = ''; // 待返回的HTML
      var lastPos = 0; // 上一个标签结束位置
      var tagStart = false; // 当前标签开始位置
      var quoteStart = false; // 引号开始位置
      var currentPos = 0; // 当前位置
      var len = html.length; // HTML长度
      var currentHtml = ''; // 当前标签的HTML代码
      var currentTagName = ''; // 当前标签的名称

      // 逐个分析字符
      for (currentPos = 0; currentPos < len; currentPos++) {
        var c = html.charAt(currentPos);
        if (tagStart === false) {
          if (c === '<') {
            tagStart = currentPos;
            continue;
          }
        } else {
          if (quoteStart === false) {
            if (c === '<') {
              rethtml += escapeHtml(html.slice(lastPos, currentPos));
              tagStart = currentPos;
              lastPos = currentPos;
              continue;
            }
            if (c === '>') {
              rethtml += escapeHtml(html.slice(lastPos, tagStart));
              currentHtml = html.slice(tagStart, currentPos + 1);
              currentTagName = getTagName(currentHtml);
              rethtml += onTag(tagStart, rethtml.length, currentTagName, currentHtml, isClosing(currentHtml));
              lastPos = currentPos + 1;
              tagStart = false;
              continue;
            }
            // HTML标签内的引号仅当前一个字符是等于号时才有效
            if ((c === '"' || c === "'") && html.charAt(currentPos - 1) === '=') {
              quoteStart = c;
              continue;
            }
          } else {
            if (c === quoteStart) {
              quoteStart = false;
              continue;
            }
          }
        }
      }
      if (lastPos < html.length) {
        rethtml += escapeHtml(html.substr(lastPos));
      }

      return rethtml;
    }

    // 不符合属性名称规则的正则表达式
    var REGEXP_ATTR_NAME = /[^a-zA-Z0-9_:\.\-]/img;

    /**
     * 分析标签HTML代码，调用相应的函数处理，返回HTML
     *
     * @param {String} html 如标签'<a href="#" target="_blank">' 则为 'href="#" target="_blank"'
     * @param {Function} onAttr 处理属性值的函数
     *   函数格式： function (name, value)
     * @return {String}
     */
    function parseAttr(html, onAttr) {
      'user strict';

      var lastPos = 0; // 当前位置
      var retAttrs = []; // 待返回的属性列表
      var tmpName = false; // 临时属性名称
      var len = html.length; // HTML代码长度

      function addAttr(name, value) {
        name = _.trim(name);
        name = name.replace(REGEXP_ATTR_NAME, '').toLowerCase();
        if (name.length < 1) return;
        var ret = onAttr(name, value || '');
        if (ret) retAttrs.push(ret);
      };

      // 逐个分析字符
      for (var i = 0; i < len; i++) {
        var c = html.charAt(i);
        var v, j;
        if (tmpName === false && c === '=') {
          tmpName = html.slice(lastPos, i);
          lastPos = i + 1;
          continue;
        }
        if (tmpName !== false) {
          // HTML标签内的引号仅当前一个字符是等于号时才有效
          if (i === lastPos && (c === '"' || c === "'") && html.charAt(i - 1) === '=') {
            j = html.indexOf(c, i + 1);
            if (j === -1) {
              break;
            } else {
              v = _.trim(html.slice(lastPos + 1, j));
              addAttr(tmpName, v);
              tmpName = false;
              i = j;
              lastPos = i + 1;
              continue;
            }
          }
        }
        if (c === ' ') {
          if (tmpName === false) {
            j = findNextEqual(html, i);
            if (j === -1) {
              v = _.trim(html.slice(lastPos, i));
              addAttr(v);
              tmpName = false;
              lastPos = i + 1;
              continue;
            } else {
              i = j - 1;
              continue;
            }
          } else {
            j = findBeforeEqual(html, i - 1);
            if (j === -1) {
              v = _.trim(html.slice(lastPos, i));
              v = stripQuoteWrap(v);
              addAttr(tmpName, v);
              tmpName = false;
              lastPos = i + 1;
              continue;
            } else {
              continue;
            }
          }
        }
      }

      if (lastPos < html.length) {
        if (tmpName === false) {
          addAttr(html.slice(lastPos));
        } else {
          addAttr(tmpName, stripQuoteWrap(_.trim(html.slice(lastPos))));
        }
      }

      return _.trim(retAttrs.join(' '));
    }

    function findNextEqual(str, i) {
      for (; i < str.length; i++) {
        var c = str[i];
        if (c === ' ') continue;
        if (c === '=') return i;
        return -1;
      }
    }

    function findBeforeEqual(str, i) {
      for (; i > 0; i--) {
        var c = str[i];
        if (c === ' ') continue;
        if (c === '=') return i;
        return -1;
      }
    }

    function isQuoteWrapString(text) {
      if (text[0] === '"' && text[text.length - 1] === '"' || text[0] === '\'' && text[text.length - 1] === '\'') {
        return true;
      } else {
        return false;
      }
    };

    function stripQuoteWrap(text) {
      if (isQuoteWrapString(text)) {
        return text.substr(1, text.length - 2);
      } else {
        return text;
      }
    };

    exports.parseTag = parseTag;
    exports.parseAttr = parseAttr;
  }, { "./util": 4 }], 4: [function (_require, module, exports) {
    module.exports = {
      indexOf: function indexOf(arr, item) {
        var i, j;
        if (Array.prototype.indexOf) {
          return arr.indexOf(item);
        }
        for (i = 0, j = arr.length; i < j; i++) {
          if (arr[i] === item) {
            return i;
          }
        }
        return -1;
      },
      forEach: function forEach(arr, fn, scope) {
        var i, j;
        if (Array.prototype.forEach) {
          return arr.forEach(fn, scope);
        }
        for (i = 0, j = arr.length; i < j; i++) {
          fn.call(scope, arr[i], i, arr);
        }
      },
      trim: function trim(str) {
        if (String.prototype.trim) {
          return str.trim();
        }
        return str.replace(/(^\s*)|(\s*$)/g, '');
      }
    };
  }, {}], 5: [function (_require, module, exports) {
    /**
     * 过滤XSS
     *
     * @author 老雷<leizongmin@gmail.com>
     */

    var FilterCSS = _require('cssfilter').FilterCSS;
    var DEFAULT = _require('./default');
    var parser = _require('./parser');
    var parseTag = parser.parseTag;
    var parseAttr = parser.parseAttr;
    var _ = _require('./util');

    /**
     * 返回值是否为空
     *
     * @param {Object} obj
     * @return {Boolean}
     */
    function isNull(obj) {
      return obj === undefined || obj === null;
    }

    /**
     * 取标签内的属性列表字符串
     *
     * @param {String} html
     * @return {Object}
     *   - {String} html
     *   - {Boolean} closing
     */
    function getAttrs(html) {
      var i = html.indexOf(' ');
      if (i === -1) {
        return {
          html: '',
          closing: html[html.length - 2] === '/'
        };
      }
      html = _.trim(html.slice(i + 1, -1));
      var isClosing = html[html.length - 1] === '/';
      if (isClosing) html = _.trim(html.slice(0, -1));
      return {
        html: html,
        closing: isClosing
      };
    }

    /**
     * XSS过滤对象
     *
     * @param {Object} options
     *   选项：whiteList, onTag, onTagAttr, onIgnoreTag,
     *        onIgnoreTagAttr, safeAttrValue, escapeHtml
     *        stripIgnoreTagBody, allowCommentTag, stripBlankChar
     *        css{whiteList, onAttr, onIgnoreAttr}
     */
    function FilterXSS(options) {
      options = options || {};

      if (options.stripIgnoreTag) {
        if (options.onIgnoreTag) {
          console.error('Notes: cannot use these two options "stripIgnoreTag" and "onIgnoreTag" at the same time');
        }
        options.onIgnoreTag = DEFAULT.onIgnoreTagStripAll;
      }

      options.whiteList = options.whiteList || DEFAULT.whiteList;
      options.onTag = options.onTag || DEFAULT.onTag;
      options.onTagAttr = options.onTagAttr || DEFAULT.onTagAttr;
      options.onIgnoreTag = options.onIgnoreTag || DEFAULT.onIgnoreTag;
      options.onIgnoreTagAttr = options.onIgnoreTagAttr || DEFAULT.onIgnoreTagAttr;
      options.safeAttrValue = options.safeAttrValue || DEFAULT.safeAttrValue;
      options.escapeHtml = options.escapeHtml || DEFAULT.escapeHtml;
      options.css = options.css || {};
      this.options = options;

      this.cssFilter = new FilterCSS(options.css);
    }

    /**
     * 开始处理
     *
     * @param {String} html
     * @return {String}
     */
    FilterXSS.prototype.process = function (html) {
      // 兼容各种奇葩输入
      html = html || '';
      html = html.toString();
      if (!html) return '';

      var me = this;
      var options = me.options;
      var whiteList = options.whiteList;
      var onTag = options.onTag;
      var onIgnoreTag = options.onIgnoreTag;
      var onTagAttr = options.onTagAttr;
      var onIgnoreTagAttr = options.onIgnoreTagAttr;
      var safeAttrValue = options.safeAttrValue;
      var escapeHtml = options.escapeHtml;
      var cssFilter = me.cssFilter;

      // 是否清除不可见字符
      if (options.stripBlankChar) {
        html = DEFAULT.stripBlankChar(html);
      }

      // 是否禁止备注标签
      if (!options.allowCommentTag) {
        html = DEFAULT.stripCommentTag(html);
      }

      // 如果开启了stripIgnoreTagBody
      var stripIgnoreTagBody = false;
      if (options.stripIgnoreTagBody) {
        var stripIgnoreTagBody = DEFAULT.StripTagBody(options.stripIgnoreTagBody, onIgnoreTag);
        onIgnoreTag = stripIgnoreTagBody.onIgnoreTag;
      }

      var retHtml = parseTag(html, function (sourcePosition, position, tag, html, isClosing) {
        var info = {
          sourcePosition: sourcePosition,
          position: position,
          isClosing: isClosing,
          isWhite: tag in whiteList
        };

        // 调用onTag处理
        var ret = onTag(tag, html, info);
        if (!isNull(ret)) return ret;

        // 默认标签处理方法
        if (info.isWhite) {
          // 白名单标签，解析标签属性
          // 如果是闭合标签，则不需要解析属性
          if (info.isClosing) {
            return '</' + tag + '>';
          }

          var attrs = getAttrs(html);
          var whiteAttrList = whiteList[tag];
          var attrsHtml = parseAttr(attrs.html, function (name, value) {

            // 调用onTagAttr处理
            var isWhiteAttr = _.indexOf(whiteAttrList, name) !== -1;
            var ret = onTagAttr(tag, name, value, isWhiteAttr);
            if (!isNull(ret)) return ret;

            // 默认的属性处理方法
            if (isWhiteAttr) {
              // 白名单属性，调用safeAttrValue过滤属性值
              value = safeAttrValue(tag, name, value, cssFilter);
              if (value) {
                return name + '="' + value + '"';
              } else {
                return name;
              }
            } else {
              // 非白名单属性，调用onIgnoreTagAttr处理
              var ret = onIgnoreTagAttr(tag, name, value, isWhiteAttr);
              if (!isNull(ret)) return ret;
              return;
            }
          });

          // 构造新的标签代码
          var html = '<' + tag;
          if (attrsHtml) html += ' ' + attrsHtml;
          if (attrs.closing) html += ' /';
          html += '>';
          return html;
        } else {
          // 非白名单标签，调用onIgnoreTag处理
          var ret = onIgnoreTag(tag, html, info);
          if (!isNull(ret)) return ret;
          return escapeHtml(html);
        }
      }, escapeHtml);

      // 如果开启了stripIgnoreTagBody，需要对结果再进行处理
      if (stripIgnoreTagBody) {
        retHtml = stripIgnoreTagBody.remove(retHtml);
      }

      return retHtml;
    };

    module.exports = FilterXSS;
  }, { "./default": 1, "./parser": 3, "./util": 4, "cssfilter": 8 }], 6: [function (_require, module, exports) {
    /**
     * cssfilter
     *
     * @author 老雷<leizongmin@gmail.com>
     */

    var DEFAULT = _require('./default');
    var parseStyle = _require('./parser');
    var _ = _require('./util');

    /**
     * 返回值是否为空
     *
     * @param {Object} obj
     * @return {Boolean}
     */
    function isNull(obj) {
      return obj === undefined || obj === null;
    }

    /**
     * 创建CSS过滤器
     *
     * @param {Object} options
     *   - {Object} whiteList
     *   - {Object} onAttr
     *   - {Object} onIgnoreAttr
     */
    function FilterCSS(options) {
      options = options || {};
      options.whiteList = options.whiteList || DEFAULT.whiteList;
      options.onAttr = options.onAttr || DEFAULT.onAttr;
      options.onIgnoreAttr = options.onIgnoreAttr || DEFAULT.onIgnoreAttr;
      this.options = options;
    }

    FilterCSS.prototype.process = function (css) {
      // 兼容各种奇葩输入
      css = css || '';
      css = css.toString();
      if (!css) return '';

      var me = this;
      var options = me.options;
      var whiteList = options.whiteList;
      var onAttr = options.onAttr;
      var onIgnoreAttr = options.onIgnoreAttr;

      var retCSS = parseStyle(css, function (sourcePosition, position, name, value, source) {

        var check = whiteList[name];
        var isWhite = false;
        if (check === true) isWhite = check;else if (typeof check === 'function') isWhite = check(value);else if (check instanceof RegExp) isWhite = check.test(value);
        if (isWhite !== true) isWhite = false;

        var opts = {
          position: position,
          sourcePosition: sourcePosition,
          source: source,
          isWhite: isWhite
        };

        if (isWhite) {

          var ret = onAttr(name, value, opts);
          if (isNull(ret)) {
            return name + ':' + value;
          } else {
            return ret;
          }
        } else {

          var ret = onIgnoreAttr(name, value, opts);
          if (!isNull(ret)) {
            return ret;
          }
        }
      });

      return retCSS;
    };

    module.exports = FilterCSS;
  }, { "./default": 7, "./parser": 9, "./util": 10 }], 7: [function (_require, module, exports) {
    /**
     * cssfilter
     *
     * @author 老雷<leizongmin@gmail.com>
     */

    function getDefaultWhiteList() {
      // 白名单值说明：
      // true: 允许该属性
      // Function: function (val) { } 返回true表示允许该属性，其他值均表示不允许
      // RegExp: regexp.test(val) 返回true表示允许该属性，其他值均表示不允许
      // 除上面列出的值外均表示不允许
      var whiteList = {};

      whiteList['align-content'] = false; // default: auto
      whiteList['align-items'] = false; // default: auto
      whiteList['align-self'] = false; // default: auto
      whiteList['alignment-adjust'] = false; // default: auto
      whiteList['alignment-baseline'] = false; // default: baseline
      whiteList['all'] = false; // default: depending on individual properties
      whiteList['anchor-point'] = false; // default: none
      whiteList['animation'] = false; // default: depending on individual properties
      whiteList['animation-delay'] = false; // default: 0
      whiteList['animation-direction'] = false; // default: normal
      whiteList['animation-duration'] = false; // default: 0
      whiteList['animation-fill-mode'] = false; // default: none
      whiteList['animation-iteration-count'] = false; // default: 1
      whiteList['animation-name'] = false; // default: none
      whiteList['animation-play-state'] = false; // default: running
      whiteList['animation-timing-function'] = false; // default: ease
      whiteList['azimuth'] = false; // default: center
      whiteList['backface-visibility'] = false; // default: visible
      whiteList['background'] = true; // default: depending on individual properties
      whiteList['background-attachment'] = true; // default: scroll
      whiteList['background-clip'] = true; // default: border-box
      whiteList['background-color'] = true; // default: transparent
      whiteList['background-image'] = true; // default: none
      whiteList['background-origin'] = true; // default: padding-box
      whiteList['background-position'] = true; // default: 0% 0%
      whiteList['background-repeat'] = true; // default: repeat
      whiteList['background-size'] = true; // default: auto
      whiteList['baseline-shift'] = false; // default: baseline
      whiteList['binding'] = false; // default: none
      whiteList['bleed'] = false; // default: 6pt
      whiteList['bookmark-label'] = false; // default: content()
      whiteList['bookmark-level'] = false; // default: none
      whiteList['bookmark-state'] = false; // default: open
      whiteList['border'] = true; // default: depending on individual properties
      whiteList['border-bottom'] = true; // default: depending on individual properties
      whiteList['border-bottom-color'] = true; // default: current color
      whiteList['border-bottom-left-radius'] = true; // default: 0
      whiteList['border-bottom-right-radius'] = true; // default: 0
      whiteList['border-bottom-style'] = true; // default: none
      whiteList['border-bottom-width'] = true; // default: medium
      whiteList['border-collapse'] = true; // default: separate
      whiteList['border-color'] = true; // default: depending on individual properties
      whiteList['border-image'] = true; // default: none
      whiteList['border-image-outset'] = true; // default: 0
      whiteList['border-image-repeat'] = true; // default: stretch
      whiteList['border-image-slice'] = true; // default: 100%
      whiteList['border-image-source'] = true; // default: none
      whiteList['border-image-width'] = true; // default: 1
      whiteList['border-left'] = true; // default: depending on individual properties
      whiteList['border-left-color'] = true; // default: current color
      whiteList['border-left-style'] = true; // default: none
      whiteList['border-left-width'] = true; // default: medium
      whiteList['border-radius'] = true; // default: 0
      whiteList['border-right'] = true; // default: depending on individual properties
      whiteList['border-right-color'] = true; // default: current color
      whiteList['border-right-style'] = true; // default: none
      whiteList['border-right-width'] = true; // default: medium
      whiteList['border-spacing'] = true; // default: 0
      whiteList['border-style'] = true; // default: depending on individual properties
      whiteList['border-top'] = true; // default: depending on individual properties
      whiteList['border-top-color'] = true; // default: current color
      whiteList['border-top-left-radius'] = true; // default: 0
      whiteList['border-top-right-radius'] = true; // default: 0
      whiteList['border-top-style'] = true; // default: none
      whiteList['border-top-width'] = true; // default: medium
      whiteList['border-width'] = true; // default: depending on individual properties
      whiteList['bottom'] = false; // default: auto
      whiteList['box-decoration-break'] = true; // default: slice
      whiteList['box-shadow'] = true; // default: none
      whiteList['box-sizing'] = true; // default: content-box
      whiteList['box-snap'] = true; // default: none
      whiteList['box-suppress'] = true; // default: show
      whiteList['break-after'] = true; // default: auto
      whiteList['break-before'] = true; // default: auto
      whiteList['break-inside'] = true; // default: auto
      whiteList['caption-side'] = false; // default: top
      whiteList['chains'] = false; // default: none
      whiteList['clear'] = true; // default: none
      whiteList['clip'] = false; // default: auto
      whiteList['clip-path'] = false; // default: none
      whiteList['clip-rule'] = false; // default: nonzero
      whiteList['color'] = true; // default: implementation dependent
      whiteList['color-interpolation-filters'] = true; // default: auto
      whiteList['column-count'] = false; // default: auto
      whiteList['column-fill'] = false; // default: balance
      whiteList['column-gap'] = false; // default: normal
      whiteList['column-rule'] = false; // default: depending on individual properties
      whiteList['column-rule-color'] = false; // default: current color
      whiteList['column-rule-style'] = false; // default: medium
      whiteList['column-rule-width'] = false; // default: medium
      whiteList['column-span'] = false; // default: none
      whiteList['column-width'] = false; // default: auto
      whiteList['columns'] = false; // default: depending on individual properties
      whiteList['contain'] = false; // default: none
      whiteList['content'] = false; // default: normal
      whiteList['counter-increment'] = false; // default: none
      whiteList['counter-reset'] = false; // default: none
      whiteList['counter-set'] = false; // default: none
      whiteList['crop'] = false; // default: auto
      whiteList['cue'] = false; // default: depending on individual properties
      whiteList['cue-after'] = false; // default: none
      whiteList['cue-before'] = false; // default: none
      whiteList['cursor'] = false; // default: auto
      whiteList['direction'] = false; // default: ltr
      whiteList['display'] = true; // default: depending on individual properties
      whiteList['display-inside'] = true; // default: auto
      whiteList['display-list'] = true; // default: none
      whiteList['display-outside'] = true; // default: inline-level
      whiteList['dominant-baseline'] = false; // default: auto
      whiteList['elevation'] = false; // default: level
      whiteList['empty-cells'] = false; // default: show
      whiteList['filter'] = false; // default: none
      whiteList['flex'] = false; // default: depending on individual properties
      whiteList['flex-basis'] = false; // default: auto
      whiteList['flex-direction'] = false; // default: row
      whiteList['flex-flow'] = false; // default: depending on individual properties
      whiteList['flex-grow'] = false; // default: 0
      whiteList['flex-shrink'] = false; // default: 1
      whiteList['flex-wrap'] = false; // default: nowrap
      whiteList['float'] = false; // default: none
      whiteList['float-offset'] = false; // default: 0 0
      whiteList['flood-color'] = false; // default: black
      whiteList['flood-opacity'] = false; // default: 1
      whiteList['flow-from'] = false; // default: none
      whiteList['flow-into'] = false; // default: none
      whiteList['font'] = true; // default: depending on individual properties
      whiteList['font-family'] = true; // default: implementation dependent
      whiteList['font-feature-settings'] = true; // default: normal
      whiteList['font-kerning'] = true; // default: auto
      whiteList['font-language-override'] = true; // default: normal
      whiteList['font-size'] = true; // default: medium
      whiteList['font-size-adjust'] = true; // default: none
      whiteList['font-stretch'] = true; // default: normal
      whiteList['font-style'] = true; // default: normal
      whiteList['font-synthesis'] = true; // default: weight style
      whiteList['font-variant'] = true; // default: normal
      whiteList['font-variant-alternates'] = true; // default: normal
      whiteList['font-variant-caps'] = true; // default: normal
      whiteList['font-variant-east-asian'] = true; // default: normal
      whiteList['font-variant-ligatures'] = true; // default: normal
      whiteList['font-variant-numeric'] = true; // default: normal
      whiteList['font-variant-position'] = true; // default: normal
      whiteList['font-weight'] = true; // default: normal
      whiteList['grid'] = false; // default: depending on individual properties
      whiteList['grid-area'] = false; // default: depending on individual properties
      whiteList['grid-auto-columns'] = false; // default: auto
      whiteList['grid-auto-flow'] = false; // default: none
      whiteList['grid-auto-rows'] = false; // default: auto
      whiteList['grid-column'] = false; // default: depending on individual properties
      whiteList['grid-column-end'] = false; // default: auto
      whiteList['grid-column-start'] = false; // default: auto
      whiteList['grid-row'] = false; // default: depending on individual properties
      whiteList['grid-row-end'] = false; // default: auto
      whiteList['grid-row-start'] = false; // default: auto
      whiteList['grid-template'] = false; // default: depending on individual properties
      whiteList['grid-template-areas'] = false; // default: none
      whiteList['grid-template-columns'] = false; // default: none
      whiteList['grid-template-rows'] = false; // default: none
      whiteList['hanging-punctuation'] = false; // default: none
      whiteList['height'] = true; // default: auto
      whiteList['hyphens'] = false; // default: manual
      whiteList['icon'] = false; // default: auto
      whiteList['image-orientation'] = false; // default: auto
      whiteList['image-resolution'] = false; // default: normal
      whiteList['ime-mode'] = false; // default: auto
      whiteList['initial-letters'] = false; // default: normal
      whiteList['inline-box-align'] = false; // default: last
      whiteList['justify-content'] = false; // default: auto
      whiteList['justify-items'] = false; // default: auto
      whiteList['justify-self'] = false; // default: auto
      whiteList['left'] = false; // default: auto
      whiteList['letter-spacing'] = true; // default: normal
      whiteList['lighting-color'] = true; // default: white
      whiteList['line-box-contain'] = false; // default: block inline replaced
      whiteList['line-break'] = false; // default: auto
      whiteList['line-grid'] = false; // default: match-parent
      whiteList['line-height'] = false; // default: normal
      whiteList['line-snap'] = false; // default: none
      whiteList['line-stacking'] = false; // default: depending on individual properties
      whiteList['line-stacking-ruby'] = false; // default: exclude-ruby
      whiteList['line-stacking-shift'] = false; // default: consider-shifts
      whiteList['line-stacking-strategy'] = false; // default: inline-line-height
      whiteList['list-style'] = true; // default: depending on individual properties
      whiteList['list-style-image'] = true; // default: none
      whiteList['list-style-position'] = true; // default: outside
      whiteList['list-style-type'] = true; // default: disc
      whiteList['margin'] = true; // default: depending on individual properties
      whiteList['margin-bottom'] = true; // default: 0
      whiteList['margin-left'] = true; // default: 0
      whiteList['margin-right'] = true; // default: 0
      whiteList['margin-top'] = true; // default: 0
      whiteList['marker-offset'] = false; // default: auto
      whiteList['marker-side'] = false; // default: list-item
      whiteList['marks'] = false; // default: none
      whiteList['mask'] = false; // default: border-box
      whiteList['mask-box'] = false; // default: see individual properties
      whiteList['mask-box-outset'] = false; // default: 0
      whiteList['mask-box-repeat'] = false; // default: stretch
      whiteList['mask-box-slice'] = false; // default: 0 fill
      whiteList['mask-box-source'] = false; // default: none
      whiteList['mask-box-width'] = false; // default: auto
      whiteList['mask-clip'] = false; // default: border-box
      whiteList['mask-image'] = false; // default: none
      whiteList['mask-origin'] = false; // default: border-box
      whiteList['mask-position'] = false; // default: center
      whiteList['mask-repeat'] = false; // default: no-repeat
      whiteList['mask-size'] = false; // default: border-box
      whiteList['mask-source-type'] = false; // default: auto
      whiteList['mask-type'] = false; // default: luminance
      whiteList['max-height'] = true; // default: none
      whiteList['max-lines'] = false; // default: none
      whiteList['max-width'] = true; // default: none
      whiteList['min-height'] = true; // default: 0
      whiteList['min-width'] = true; // default: 0
      whiteList['move-to'] = false; // default: normal
      whiteList['nav-down'] = false; // default: auto
      whiteList['nav-index'] = false; // default: auto
      whiteList['nav-left'] = false; // default: auto
      whiteList['nav-right'] = false; // default: auto
      whiteList['nav-up'] = false; // default: auto
      whiteList['object-fit'] = false; // default: fill
      whiteList['object-position'] = false; // default: 50% 50%
      whiteList['opacity'] = false; // default: 1
      whiteList['order'] = false; // default: 0
      whiteList['orphans'] = false; // default: 2
      whiteList['outline'] = false; // default: depending on individual properties
      whiteList['outline-color'] = false; // default: invert
      whiteList['outline-offset'] = false; // default: 0
      whiteList['outline-style'] = false; // default: none
      whiteList['outline-width'] = false; // default: medium
      whiteList['overflow'] = false; // default: depending on individual properties
      whiteList['overflow-wrap'] = false; // default: normal
      whiteList['overflow-x'] = false; // default: visible
      whiteList['overflow-y'] = false; // default: visible
      whiteList['padding'] = true; // default: depending on individual properties
      whiteList['padding-bottom'] = true; // default: 0
      whiteList['padding-left'] = true; // default: 0
      whiteList['padding-right'] = true; // default: 0
      whiteList['padding-top'] = true; // default: 0
      whiteList['page'] = false; // default: auto
      whiteList['page-break-after'] = false; // default: auto
      whiteList['page-break-before'] = false; // default: auto
      whiteList['page-break-inside'] = false; // default: auto
      whiteList['page-policy'] = false; // default: start
      whiteList['pause'] = false; // default: implementation dependent
      whiteList['pause-after'] = false; // default: implementation dependent
      whiteList['pause-before'] = false; // default: implementation dependent
      whiteList['perspective'] = false; // default: none
      whiteList['perspective-origin'] = false; // default: 50% 50%
      whiteList['pitch'] = false; // default: medium
      whiteList['pitch-range'] = false; // default: 50
      whiteList['play-during'] = false; // default: auto
      whiteList['position'] = false; // default: static
      whiteList['presentation-level'] = false; // default: 0
      whiteList['quotes'] = false; // default: text
      whiteList['region-fragment'] = false; // default: auto
      whiteList['resize'] = false; // default: none
      whiteList['rest'] = false; // default: depending on individual properties
      whiteList['rest-after'] = false; // default: none
      whiteList['rest-before'] = false; // default: none
      whiteList['richness'] = false; // default: 50
      whiteList['right'] = false; // default: auto
      whiteList['rotation'] = false; // default: 0
      whiteList['rotation-point'] = false; // default: 50% 50%
      whiteList['ruby-align'] = false; // default: auto
      whiteList['ruby-merge'] = false; // default: separate
      whiteList['ruby-position'] = false; // default: before
      whiteList['shape-image-threshold'] = false; // default: 0.0
      whiteList['shape-outside'] = false; // default: none
      whiteList['shape-margin'] = false; // default: 0
      whiteList['size'] = false; // default: auto
      whiteList['speak'] = false; // default: auto
      whiteList['speak-as'] = false; // default: normal
      whiteList['speak-header'] = false; // default: once
      whiteList['speak-numeral'] = false; // default: continuous
      whiteList['speak-punctuation'] = false; // default: none
      whiteList['speech-rate'] = false; // default: medium
      whiteList['stress'] = false; // default: 50
      whiteList['string-set'] = false; // default: none
      whiteList['tab-size'] = false; // default: 8
      whiteList['table-layout'] = false; // default: auto
      whiteList['text-align'] = true; // default: start
      whiteList['text-align-last'] = true; // default: auto
      whiteList['text-combine-upright'] = true; // default: none
      whiteList['text-decoration'] = true; // default: none
      whiteList['text-decoration-color'] = true; // default: currentColor
      whiteList['text-decoration-line'] = true; // default: none
      whiteList['text-decoration-skip'] = true; // default: objects
      whiteList['text-decoration-style'] = true; // default: solid
      whiteList['text-emphasis'] = true; // default: depending on individual properties
      whiteList['text-emphasis-color'] = true; // default: currentColor
      whiteList['text-emphasis-position'] = true; // default: over right
      whiteList['text-emphasis-style'] = true; // default: none
      whiteList['text-height'] = true; // default: auto
      whiteList['text-indent'] = true; // default: 0
      whiteList['text-justify'] = true; // default: auto
      whiteList['text-orientation'] = true; // default: mixed
      whiteList['text-overflow'] = true; // default: clip
      whiteList['text-shadow'] = true; // default: none
      whiteList['text-space-collapse'] = true; // default: collapse
      whiteList['text-transform'] = true; // default: none
      whiteList['text-underline-position'] = true; // default: auto
      whiteList['text-wrap'] = true; // default: normal
      whiteList['top'] = false; // default: auto
      whiteList['transform'] = false; // default: none
      whiteList['transform-origin'] = false; // default: 50% 50% 0
      whiteList['transform-style'] = false; // default: flat
      whiteList['transition'] = false; // default: depending on individual properties
      whiteList['transition-delay'] = false; // default: 0s
      whiteList['transition-duration'] = false; // default: 0s
      whiteList['transition-property'] = false; // default: all
      whiteList['transition-timing-function'] = false; // default: ease
      whiteList['unicode-bidi'] = false; // default: normal
      whiteList['vertical-align'] = false; // default: baseline
      whiteList['visibility'] = false; // default: visible
      whiteList['voice-balance'] = false; // default: center
      whiteList['voice-duration'] = false; // default: auto
      whiteList['voice-family'] = false; // default: implementation dependent
      whiteList['voice-pitch'] = false; // default: medium
      whiteList['voice-range'] = false; // default: medium
      whiteList['voice-rate'] = false; // default: normal
      whiteList['voice-stress'] = false; // default: normal
      whiteList['voice-volume'] = false; // default: medium
      whiteList['volume'] = false; // default: medium
      whiteList['white-space'] = false; // default: normal
      whiteList['widows'] = false; // default: 2
      whiteList['width'] = true; // default: auto
      whiteList['will-change'] = false; // default: auto
      whiteList['word-break'] = true; // default: normal
      whiteList['word-spacing'] = true; // default: normal
      whiteList['word-wrap'] = true; // default: normal
      whiteList['wrap-flow'] = false; // default: auto
      whiteList['wrap-through'] = false; // default: wrap
      whiteList['writing-mode'] = false; // default: horizontal-tb
      whiteList['z-index'] = false; // default: auto

      return whiteList;
    }

    /**
     * 匹配到白名单上的一个属性时
     *
     * @param {String} name
     * @param {String} value
     * @param {Object} options
     * @return {String}
     */
    function onAttr(name, value, options) {}
    // do nothing

    /**
     * 匹配到不在白名单上的一个属性时
     *
     * @param {String} name
     * @param {String} value
     * @param {Object} options
     * @return {String}
     */
    function onIgnoreAttr(name, value, options) {
      // do nothing
    }

    exports.whiteList = getDefaultWhiteList();
    exports.getDefaultWhiteList = getDefaultWhiteList;
    exports.onAttr = onAttr;
    exports.onIgnoreAttr = onIgnoreAttr;
  }, {}], 8: [function (_require, module, exports) {
    /**
     * cssfilter
     *
     * @author 老雷<leizongmin@gmail.com>
     */

    var DEFAULT = _require('./default');
    var FilterCSS = _require('./css');

    /**
     * XSS过滤
     *
     * @param {String} css 要过滤的CSS代码
     * @param {Object} options 选项：whiteList, onAttr, onIgnoreAttr
     * @return {String}
     */
    function filterCSS(html, options) {
      var xss = new FilterCSS(options);
      return xss.process(html);
    }

    // 输出
    exports = module.exports = filterCSS;
    exports.FilterCSS = FilterCSS;
    for (var i in DEFAULT) exports[i] = DEFAULT[i];

    // 在浏览器端使用
    if (typeof window !== 'undefined') {
      window.filterCSS = module.exports;
    }
  }, { "./css": 6, "./default": 7 }], 9: [function (_require, module, exports) {
    /**
     * cssfilter
     *
     * @author 老雷<leizongmin@gmail.com>
     */

    var _ = _require('./util');

    /**
     * 解析style
     *
     * @param {String} css
     * @param {Function} onAttr 处理属性的函数
     *   参数格式： function (sourcePosition, position, name, value, source)
     * @return {String}
     */
    function parseStyle(css, onAttr) {
      css = _.trimRight(css);
      if (css[css.length - 1] !== ';') css += ';';
      var cssLength = css.length;
      var isParenthesisOpen = false;
      var lastPos = 0;
      var i = 0;
      var retCSS = '';

      function addNewAttr() {
        // 如果没有正常的闭合圆括号，则直接忽略当前属性
        if (!isParenthesisOpen) {
          var source = _.trim(css.slice(lastPos, i));
          var j = source.indexOf(':');
          if (j !== -1) {
            var name = _.trim(source.slice(0, j));
            var value = _.trim(source.slice(j + 1));
            // 必须有属性名称
            if (name) {
              var ret = onAttr(lastPos, retCSS.length, name, value, source);
              if (ret) retCSS += ret + '; ';
            }
          }
        }
        lastPos = i + 1;
      }

      for (; i < cssLength; i++) {
        var c = css[i];
        if (c === '/' && css[i + 1] === '*') {
          // 备注开始
          var j = css.indexOf('*/', i + 2);
          // 如果没有正常的备注结束，则后面的部分全部跳过
          if (j === -1) break;
          // 直接将当前位置调到备注结尾，并且初始化状态
          i = j + 1;
          lastPos = i + 1;
          isParenthesisOpen = false;
        } else if (c === '(') {
          isParenthesisOpen = true;
        } else if (c === ')') {
          isParenthesisOpen = false;
        } else if (c === ';') {
          if (isParenthesisOpen) {
            // 在圆括号里面，忽略
          } else {
              addNewAttr();
            }
        } else if (c === '\n') {
          addNewAttr();
        }
      }

      return _.trim(retCSS);
    }

    module.exports = parseStyle;
  }, { "./util": 10 }], 10: [function (_require, module, exports) {
    module.exports = {
      indexOf: function indexOf(arr, item) {
        var i, j;
        if (Array.prototype.indexOf) {
          return arr.indexOf(item);
        }
        for (i = 0, j = arr.length; i < j; i++) {
          if (arr[i] === item) {
            return i;
          }
        }
        return -1;
      },
      forEach: function forEach(arr, fn, scope) {
        var i, j;
        if (Array.prototype.forEach) {
          return arr.forEach(fn, scope);
        }
        for (i = 0, j = arr.length; i < j; i++) {
          fn.call(scope, arr[i], i, arr);
        }
      },
      trim: function trim(str) {
        if (String.prototype.trim) {
          return str.trim();
        }
        return str.replace(/(^\s*)|(\s*$)/g, '');
      },
      trimRight: function trimRight(str) {
        if (String.prototype.trimRight) {
          return str.trimRight();
        }
        return str.replace(/(\s*$)/g, '');
      }
    };
  }, {}] }, {}, [2]);

exports["default"] = filterXSS;
module.exports = exports["default"];

},{}],23:[function(require,module,exports){
/**
 * Dom 操作工具包（基础核心包，主要都是 get 等读取操作）
 *
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('./../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('./../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('./../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var domUtils = {
    /**
     * 添加 class name
     * @param domList
     * @param className
     */
    addClass: function addClass(domList, className) {
        if (!domList) {
            return;
        }
        if (!!domList.nodeType) {
            domList = [domList];
        }
        var i, dom;
        for (i = domList.length - 1; i >= 0; i--) {
            dom = domList[i];
            if (dom.nodeType === 1 && !domUtils.hasClass(dom, className)) {
                dom.className = (dom.className + ' ' + className).trim();
            }
        }
    },
    /**
     * 给 DOM.getAttribute('style') 对象 设置 样式
     * @param styleStr
     * @param styleObj
     */
    appendStyle: function appendStyle(styleStr, styleObj) {
        if (!styleStr) {
            return;
        }
        var styleList = styleStr.split(';'),
            i,
            j,
            t;
        for (i = 0, j = styleList.length; i < j; i++) {
            if (styleList[i].indexOf(':') > 0) {
                t = styleList[i].split(':');
                styleObj[t[0].trim()] = t[1].trim();
            }
        }
    },
    /**
     * 修改子节点的属性（attribute）
     * @param dom
     * @param attr
     */
    attr: function attr(dom, _attr) {
        var key, value;
        if (!dom || !_attr || dom.nodeType !== 1) {
            return;
        }
        for (key in _attr) {
            if (_attr.hasOwnProperty(key) && typeof key == 'string') {
                value = _attr[key];
                if (!value) {
                    dom.removeAttribute(key);
                } else {
                    dom.setAttribute(key, value);
                }
            }
        }
    },
    /**
     * 判断 dom 是否为可编辑的 dom 类型
     * @param dom
     * @returns {*|boolean}
     */
    canEdit: function canEdit(dom) {
        //过滤 script、style等标签
        var filterTag = ['script', 'style'];

        return dom && (dom.nodeType == 1 || dom.nodeType == 3) && (domUtils.isTag(dom, 'br') || !domUtils.isEmptyDom(dom)) && !domUtils.getParentByTagName(dom, _commonConst2['default'].TAG.TMP_TAG, true, null) && !(dom.nodeType === 1 && domUtils.isTag(dom, filterTag) || dom.nodeType === 3 && dom.parentNode && domUtils.isTag(dom.parentNode, filterTag));
    },
    /**
     * 清理 dom 内无用的 childNodes（主要用于 处理 剪切板的 html）
     * @param dom
     */
    childNodesFilter: function childNodesFilter(dom) {
        if (!dom || dom.nodeType !== 1) {
            return;
        }
        var i, d;
        for (i = dom.childNodes.length - 1; i >= 0; i--) {
            d = dom.childNodes[i];
            if (d.nodeType == 1) {
                if (/link|style|script|meta/ig.test(d.nodeName)) {
                    dom.removeChild(d);
                }
                domUtils.childNodesFilter(d);
            } else if (d.nodeType != 3) {
                dom.removeChild(d);
            }
        }
    },
    /**
     * 清除 Dom 上 某一个 inline 的 style 属性
     * @param dom
     * @param styleKey
     */
    clearStyle: function clearStyle(dom, styleKey) {
        var parent;
        while (dom.getAttribute(_commonConst2['default'].ATTR.SPAN) === _commonConst2['default'].ATTR.SPAN) {
            dom.style[styleKey] = '';

            parent = dom.parentNode;
            if (parent.getAttribute(_commonConst2['default'].ATTR.SPAN) !== _commonConst2['default'].ATTR.SPAN) {
                break;
            }
            if (!dom.previousSibling && !dom.nextSibling) {
                dom = parent;
            } else if (!dom.previousSibling) {
                domUtils.before(parent, dom, false);
                domUtils.mergeAtoB(parent, dom, false);
                dom.style[styleKey] = '';
            } else if (!dom.nextSibling) {
                domUtils.before(parent, dom, true);
                domUtils.mergeAtoB(parent, dom, false);
                dom.style[styleKey] = '';
            } else {
                var nSpan = domUtils.createSpan(),
                    tmpDom;
                nSpan.setAttribute('style', parent.getAttribute('style'));
                while (dom.nextSibling) {
                    tmpDom = dom.nextSibling;
                    nSpan.insertBefore(tmpDom, null);
                    domUtils.mergeAtoB(parent, tmpDom, false);
                }
                domUtils.before(parent, dom, true);
                domUtils.before(dom, nSpan, true);
                domUtils.mergeAtoB(parent, dom, false);
                domUtils.mergeAtoB(parent, nSpan, false);
            }
        }
    },
    /**
     * 比较 IndexList
     * @param a
     * @param b
     * @returns {number}
     */
    compareIndexList: function compareIndexList(a, b) {
        var i,
            j = Math.min(a.length, b.length),
            x,
            y;
        for (i = 0; i < j; i++) {
            x = a[i];
            y = b[i];
            if (x < y) {
                return -1;
            }
            if (x > y) {
                return 1;
            }
        }

        if (a.length < b.length) {
            return -1;
        }

        if (a.length > b.length) {
            return 1;
        }

        return 0;
    },
    /**
     * a 是否包含 b （from jQuery 1.10.2）
     * @param a
     * @param b
     * @returns {boolean}
     */
    contains: function contains(a, b) {
        var adown = a.nodeType === 9 ? a.documentElement : a,
            bup = b && b.parentNode;
        return a === bup || !!(bup && bup.nodeType === 1 && (adown.contains ? adown.contains(bup) : a.compareDocumentPosition && a.compareDocumentPosition(bup) & 16));
    },
    /**
     * 根据 src 将 img 转换为 Base64
     * @param src
     */
    convertImageToBase64: function convertImageToBase64(src, width, height, callback) {
        // var xhr = new XMLHttpRequest();
        // xhr.open('GET', src, true);
        // xhr.responseType = 'blob';
        // xhr.onload = function() {
        //     var blob, read;
        //     if (/^file:/i.test(src) || this.status == 200) {
        //         blob = this.response;
        //         read= new FileReader();
        //         read.readAsDataURL(blob);
        //         read.onload = function(){
        //             // callback(canvas.toDataURL());
        //             console.log(this.result);
        //         }
        //     } else {console.log(this)}
        // };
        // xhr.send();
        var img = _commonEnv2['default'].doc.createElement('img');
        img.onload = function () {
            var canvas = _commonEnv2['default'].doc.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            var context = canvas.getContext("2d");
            var dx = width / img.width;
            var dy = height / img.height;
            var d = Math.max(dx, dy);
            context.scale(d, d);
            context.drawImage(img, 0, 0);
            callback(canvas.toDataURL());
            img = null;
            canvas = null;
        };
        img.src = src;
    },
    /**
     * 创建 wiz编辑器 自用的 span
     */
    createSpan: function createSpan() {
        var s = _commonEnv2['default'].doc.createElement('span');
        s.setAttribute(_commonConst2['default'].ATTR.SPAN, _commonConst2['default'].ATTR.SPAN);
        return s;
    },
    /**
     * 设置 dom css
     * @param dom
     * @param style {{}}
     * @param onlyWizSpan
     */
    css: function css(dom, style, onlyWizSpan) {
        if (!dom || !style || domUtils.isTag(dom, 'br')) {
            //禁止给 br 添加任何样式
            return;
        }
        onlyWizSpan = !!onlyWizSpan;
        var k, v;
        for (k in style) {
            if (style.hasOwnProperty(k) && typeof k == 'string') {
                v = style[k];
                if (onlyWizSpan && !v && v !== 0) {
                    domUtils.clearStyle(dom, k);
                } else if (v.toString().indexOf('!important') > 0) {
                    //对于 具有 !important 的样式需要特殊添加
                    domUtils.clearStyle(dom, k);
                    dom.style.cssText += k + ':' + v;
                } else if (k.toLowerCase() == 'font-size') {
                    //如果设置的字体与 body 默认字体 同样大小， 则扩展设置 rem
                    domUtils.clearStyle(dom, k);
                    v = getRem(v);
                    if (v) {
                        dom.style.cssText += k + ':' + v;
                    }
                } else {
                    dom.style[k] = v;
                }
            }
        }

        function getRem(fontSize) {
            var s = _commonEnv2['default'].win.getComputedStyle(_commonEnv2['default'].doc.body),
                rSize = parseInt(s.fontSize, 10),
                size = parseInt(fontSize, 10);
            if (isNaN(rSize) || isNaN(size) || rSize == 0) {
                return null;
            }
            return Math.round(size / rSize * 1000) / 1000 + 'rem';
        }
    },
    /**
     * 设置 焦点
     */
    focus: function focus() {
        if (_commonEnv2['default'].win.WizTemplate) {
            _commonEnv2['default'].win.WizTemplate.focus();
        } else {
            _commonEnv2['default'].doc.body.focus();
        }
    },
    getBlockParent: function getBlockParent(dom, includeSelf) {
        if (!dom) {
            return null;
        }
        return domUtils.getParentByFilter(dom, function (obj) {
            return domUtils.isBlockDom(obj);
        }, includeSelf);
    },
    /**
     * 获取 dom 的 计算样式
     * @param dom
     * @param name
     * @param includeParent  （Boolean 如果当前Dom 不存在指定的样式，是否递归到父节点）
     * @returns {*}
     */
    getComputedStyle: function getComputedStyle(dom, name, includeParent) {
        if (!dom || dom.nodeType == 3 || !name) {
            return '';
        }
        var value;
        //while (includeParent && !value && dom!=ENV.doc.body) {
        while (!value) {
            var s = _commonEnv2['default'].win.getComputedStyle(dom);
            value = s[name] || '';

            if (/^rgba?\(.*\)$/i.test(value)) {
                value = _commonUtils2['default'].rgb2Hex(value);
            }

            if (dom == _commonEnv2['default'].doc.body || !includeParent || !!value) {
                break;
            }

            //(includeParent && !value)
            dom = dom.parentNode;
        }
        return value;
    },
    getDocType: function getDocType(doc) {
        var docType = doc.doctype;
        if (!!docType && !docType.systemId && !docType.publicId) {
            docType = '<!DOCTYPE HTML>';
        } else if (!!docType) {
            docType = '<!DOCTYPE HTML PUBLIC "' + docType.publicId + '" "' + docType.systemId + '" >';
        } else {
            docType = '<!DOCTYPE HTML>';
        }
        return docType;
    },
    /**
     * 根据 dom 树索引集合 获取 dom
     * @param indexList
     * @returns {*}
     */
    getDomByIndexList: function getDomByIndexList(indexList) {
        if (!indexList || indexList.length === 0) {
            return null;
        }
        var i, j, d, offset;
        d = _commonEnv2['default'].doc.body;
        try {
            for (i = 0, j = indexList.length - 1; i < j; i++) {
                d = d.childNodes[indexList[i]];
            }
            offset = indexList[i];
            return { dom: d, offset: offset };
        } catch (e) {
            return null;
        }
    },
    /**
     * 获取 Dom 的子元素长度（同时支持 TextNode 和 Element）
     * @param dom
     * @returns {*}
     */
    getDomEndOffset: function getDomEndOffset(dom) {
        if (!dom) {
            return 0;
        }
        return dom.nodeType == 3 ? dom.nodeValue.length : dom.childNodes.length;
    },
    /**
     * 获取 Dom 在当前相邻节点中的 位置（index）
     * @param dom
     * @returns {number}
     */
    getDomIndex: function getDomIndex(dom) {
        if (!dom || !dom.parentNode) {
            return -1;
        }
        var k = 0,
            e = dom;
        while (e = e.previousSibling) {
            ++k;
        }
        return k;
    },
    /**
     * 获取 DomA 到 DomB 中包含的所有 叶子节点
     * @param options
     * @returns {{}}
     */
    getDomListA2B: function getDomListA2B(options) {
        var startDom = options.startDom,
            startOffset = options.startOffset,
            endDom = options.endDom,
            endOffset = options.endOffset,
            noSplit = !!options.noSplit,
            isText,
            changeStart = false,
            changeEnd = false;

        //修正 start & end 位置
        if (startDom.nodeType == 1 && startOffset > 0 && startOffset < startDom.childNodes.length) {
            startDom = startDom.childNodes[startOffset];
            startOffset = 0;
        }
        if (endDom.nodeType == 1 && endOffset > 0 && endOffset < endDom.childNodes.length) {
            endDom = endDom.childNodes[endOffset];
            endOffset = 0;
        }
        //如果起始点 和终止点位置不一样， 且 endOffset == 0，则找到 endOom 前一个叶子节点
        if (startDom !== endDom && endOffset === 0) {
            endDom = domUtils.getPreviousNode(endDom, false, startDom);
            //如果 修正后的 endDom 为 自闭合标签， 需要特殊处理
            if (domUtils.isSelfClosingTag(endDom)) {
                endOffset = 1;
            } else {
                endOffset = domUtils.getDomEndOffset(endDom);
            }
        }

        // get dom which is start and end
        if (startDom == endDom && startOffset != endOffset) {
            isText = startDom.nodeType == 3;
            if (isText && !startDom.parentNode.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE)) {
                startDom = noSplit ? startDom : domUtils.splitRangeText(startDom, startOffset, endOffset);
                endDom = startDom;
                changeStart = true;
                changeEnd = true;
            } else if (startDom.nodeType == 1 && startDom.childNodes.length > 0 && !domUtils.isSelfClosingTag(startDom)) {
                startDom = startDom.childNodes[startOffset];
                endDom = endDom.childNodes[endOffset - 1];
                changeStart = true;
                changeEnd = true;
            }
        } else if (startDom !== endDom) {
            if (startDom.nodeType == 3 && !startDom.parentNode.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE)) {
                startDom = noSplit ? startDom : domUtils.splitRangeText(startDom, startOffset, null);
                changeStart = true;
            } else if (startDom.nodeType == 1 && startDom.childNodes.length > 0 && startOffset < startDom.childNodes.length) {
                startDom = startDom.childNodes[startOffset];
                changeStart = true;
            }
            if (endDom.nodeType == 3 && endOffset > 0 && !endDom.parentNode.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE)) {
                endDom = noSplit ? endDom : domUtils.splitRangeText(endDom, 0, endOffset);
                changeEnd = true;
            } else if (!domUtils.isSelfClosingTag(endDom) && endDom.nodeType == 1 && endOffset > 0) {
                endDom = domUtils.getLastDeepChild(endDom.childNodes[endOffset - 1]);
                changeEnd = true;
            }
        }
        if (changeStart) {
            startOffset = 0;
        }
        if (changeEnd) {
            endOffset = domUtils.getDomEndOffset(endDom);
        }

        //make the array
        var curDom = startDom,
            result = [];
        if (startOffset == startDom.length) {
            curDom = domUtils.getNextNode(curDom, false, endDom);
        }

        while (curDom && !(startDom == endDom && startOffset == endOffset)) {
            if (curDom == endDom || curDom == endDom.parentNode) {
                addDomForGetDomList(result, endDom);
                break;
            } else if (domUtils.isBody(curDom)) {
                addDomForGetDomList(result, curDom);
                break;
            } else {
                addDomForGetDomList(result, curDom);
            }
            curDom = domUtils.getNextNode(curDom, false, endDom);
        }

        // startDom 和 endDom 在 clearChild 操作中可能会被删除，所以必须要记住边缘 Dom 范围
        var startDomBak = domUtils.getPreviousNode(result[0], false, null),
            endDomBak = domUtils.getNextNode(result[result.length - 1], false, null);
        if (startDomBak && startDomBak.nodeType == 1 && startDomBak.firstChild) {
            startDomBak = startDomBak.firstChild;
        }
        if (endDomBak && endDomBak.nodeType == 1 && endDomBak.lastChild) {
            endDomBak = endDomBak.lastChild;
        }
        var startOffsetBak = domUtils.getDomEndOffset(startDomBak),
            endOffsetBak = 0;

        return {
            list: result,
            startDom: startDom,
            startOffset: startOffset,
            endDom: endDom,
            endOffset: endOffset,
            startDomBak: startDomBak,
            startOffsetBak: startOffsetBak,
            endDomBak: endDomBak,
            endOffsetBak: endOffsetBak
        };

        function addDomForGetDomList(main, sub) {
            main.push(sub);
        }
    },
    /**
     * 获取 DOM 的 坐标 & 大小
     * @param obj
     * @returns {*}
     */
    getDomPosition: function getDomPosition(obj) {
        if (!obj) {
            return null;
        }
        return {
            top: obj.offsetTop,
            left: obj.offsetLeft,
            height: obj.offsetHeight,
            width: obj.offsetWidth
        };
    },
    /**
     * 获取 dom 子孙元素中第一个 叶子节点
     * @param obj
     * @returns {*}
     */
    getFirstDeepChild: function getFirstDeepChild(obj) {
        if (!obj) {
            return null;
        }
        while (obj.childNodes && obj.childNodes.length > 0) {
            obj = obj.childNodes[0];
        }
        return obj;
    },
    /**
     * 获取 dom 子孙元素中最后一个 叶子节点
     * @param obj
     * @returns {*}
     */
    getLastDeepChild: function getLastDeepChild(obj) {
        if (!obj) {
            return null;
        }
        while (obj.childNodes && obj.childNodes.length > 0) {
            obj = obj.childNodes[obj.childNodes.length - 1];
        }
        return obj;
    },
    /**
     * 获取 图片数据
     * @param img
     * @returns {*}
     */
    getImageData: function getImageData(img) {
        var size = domUtils.getImageSize(img.src);
        // Create an empty canvas element
        var canvas = _commonEnv2['default'].doc.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;

        // Copy the image contents to the canvas
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);

        // Get the data-URL formatted image
        // Firefox supports PNG and JPEG. You could check img.src to
        // guess the original format, but be aware the using "image/jpg"
        // will re-encode the image.
        var dataURL = canvas.toDataURL("image/png");

        return dataURL.replace(/^data:image\/(png|jpg);base64,/, "");
    },
    /**
     * 获取 图片 宽高
     * @param imgSrc
     * @returns {{width: Number, height: Number}}
     */
    getImageSize: function getImageSize(imgSrc) {
        var newImg = new Image();
        newImg.src = imgSrc;
        var height = newImg.height;
        var width = newImg.width;
        return { width: width, height: height };
    },
    /**
     * 获取 dom 在 dom 树内的 索引集合
     * @param dom
     * @returns {Array}
     */
    getIndexListByDom: function getIndexListByDom(dom) {
        var e = dom,
            indexList = [];
        while (e && !domUtils.isBody(e)) {
            indexList.splice(0, 0, domUtils.getDomIndex(e));
            e = e.parentNode;
        }
        return indexList;
    },
    /**
     * 获取 DOM 的 下一个 可编辑的叶子节点
     * @param dom
     * @param onlyElement
     * @param endDom
     * @returns {*}
     */
    getNextNodeCanEdit: function getNextNodeCanEdit(dom, onlyElement, endDom) {
        dom = domUtils.getNextNode(dom, onlyElement, endDom);
        while (dom && !domUtils.canEdit(dom)) {
            dom = domUtils.getNextNode(dom, onlyElement, endDom);
        }
        return dom;
    },
    /**
     * 获取 DOM 的下一个叶子节点（包括不相邻的情况），到达指定的 endDom 为止（如果为空则忽略）
     * @param dom
     * @param onlyElement
     * @param endDom
     * @returns {*}
     */
    getNextNode: function getNextNode(dom, onlyElement, endDom) {
        if (!dom || dom == endDom) {
            return null;
        }
        onlyElement = !!onlyElement;
        function next(d) {
            if (!d) {
                return null;
            }
            return onlyElement ? d.nextElementSibling : d.nextSibling;
        }

        function first(d) {
            if (!d) {
                return null;
            }
            return onlyElement ? d.firstElementChild : d.firstChild;
        }

        if (!next(dom) && !dom.parentNode) {
            return null;
        } else if (!next(dom)) {
            //if hasn't nextSibling,so find its parent's nextSibling
            while (dom.parentNode) {
                dom = dom.parentNode;
                if (dom == endDom) {
                    break;
                }
                if (domUtils.isBody(dom)) {
                    dom = null;
                    break;
                }
                if (next(dom)) {
                    dom = next(dom);
                    break;
                }
            }
        } else {
            dom = next(dom);
        }

        if (dom == endDom) {
            return dom;
        }

        //if next node has child nodes, so find the first child node.
        var tmpD;
        tmpD = first(dom);
        if (!!dom && tmpD) {
            while (tmpD) {
                dom = tmpD;
                if (dom == endDom) {
                    break;
                }
                tmpD = first(tmpD);
            }
        }
        return dom;
    },
    /**
     * 获取 页面滚动条位置
     * @returns {{}}
     */
    getPageScroll: function getPageScroll() {
        var scroll = {};
        if (typeof _commonEnv2['default'].win.pageYOffset != 'undefined') {
            scroll.left = _commonEnv2['default'].win.pageXOffset;
            scroll.top = _commonEnv2['default'].win.pageYOffset;
        } else if (typeof _commonEnv2['default'].doc.compatMode != 'undefined' && _commonEnv2['default'].doc.compatMode != 'BackCompat') {
            scroll.left = _commonEnv2['default'].doc.documentElement.scrollLeft;
            scroll.top = _commonEnv2['default'].doc.documentElement.scrollTop;
        } else if (typeof _commonEnv2['default'].doc.body != 'undefined') {
            scroll.left = _commonEnv2['default'].doc.body.scrollLeft;
            scroll.top = _commonEnv2['default'].doc.body.scrollTop;
        }
        return scroll;
    },
    /**
     * 根据 filterFn 函数设置的 自定义规则 查找 Dom 的父节点
     * @param node
     * @param filterFn
     * @param includeSelf
     * @returns {*}
     */
    getParentByFilter: function getParentByFilter(node, filterFn, includeSelf) {
        if (node && !domUtils.isBody(node)) {
            node = includeSelf ? node : node.parentNode;
            while (node) {
                if (!filterFn || filterFn(node)) {
                    return node;
                }
                if (domUtils.isBody(node)) {
                    return null;
                }
                node = node.parentNode;
            }
        }
        return null;
    },
    /**
     * 根据 Tag 名称查找 Dom 的父节点
     * @param node
     * @param tagNames
     * @param includeSelf
     * @param excludeFn
     * @returns {*}
     */
    getParentByTagName: function getParentByTagName(node, tagNames, includeSelf, excludeFn) {
        if (!node) {
            return null;
        }
        tagNames = _commonUtils2['default'].listToMap(_commonUtils2['default'].isArray(tagNames) ? tagNames : [tagNames]);
        return domUtils.getParentByFilter(node, function (node) {
            return tagNames[node.tagName] && !(excludeFn && excludeFn(node));
        }, includeSelf);
    },
    /**
     * 获取多个 dom 共同的父节点
     * @param domList
     */
    getParentRoot: function getParentRoot(domList) {
        if (!domList || domList.length === 0) {
            return null;
        }
        var i,
            j,
            tmpIdx,
            pNode,
            parentList = [];
        pNode = domList[0].nodeType == 1 ? domList[0] : domList[0].parentNode;
        while (pNode && !domUtils.isBody(pNode)) {
            parentList.push(pNode);
            pNode = pNode.parentNode;
        }
        for (i = 1, j = domList.length; i < j; i++) {
            pNode = domList[i];
            while (pNode) {
                if (domUtils.isBody(pNode)) {
                    return _commonEnv2['default'].doc.body;
                }
                tmpIdx = parentList.indexOf(pNode);
                if (tmpIdx > -1) {
                    parentList.splice(0, tmpIdx);
                    break;
                }
                pNode = pNode.parentNode;
            }
        }
        if (parentList.length === 0) {
            return _commonEnv2['default'].doc.body;
        } else {
            return parentList[0];
        }
    },
    /**
     * 获取 DOM 的 下一个 可编辑的叶子节点
     * @param dom
     * @param onlyElement
     * @param endDom
     * @returns {*}
     */
    getPreviousNodeCanEdit: function getPreviousNodeCanEdit(dom, onlyElement, endDom) {
        dom = domUtils.getPreviousNode(dom, onlyElement, endDom);
        while (dom && !domUtils.canEdit(dom)) {
            dom = domUtils.getPreviousNode(dom, onlyElement, endDom);
        }
        return dom;
    },
    /**
     * 获取 DOM 的前一个叶子节点（包括不相邻的情况），到达指定的 startDom 为止（如果为空则忽略）
     * @param dom
     * @param onlyElement
     * @param startDom
     * @returns {*}
     */
    getPreviousNode: function getPreviousNode(dom, onlyElement, startDom) {
        if (!dom || dom == startDom) {
            return null;
        }
        onlyElement = !!onlyElement;
        function prev(d) {
            return onlyElement ? d.previousElementSibling : d.previousSibling;
        }

        function last(d) {
            return onlyElement ? d.lastElementChild : d.lastChild;
        }

        if (!prev(dom)) {
            //if hasn't previousSibling,so find its parent's previousSibling
            while (dom.parentNode) {
                dom = dom.parentNode;
                if (dom == startDom) {
                    break;
                }
                if (domUtils.isBody(dom)) {
                    dom = null;
                    break;
                }
                if (prev(dom)) {
                    dom = prev(dom);
                    break;
                }
            }
        } else {
            dom = prev(dom);
        }

        if (!dom) {
            return null;
        }
        //对于查找前一个dom节点的算法 与 查找 下一个dom的算法略有不同
        //如果 dom 与 startDom 相同， 但 dom 有子元素的时候， 不能直接返回 dom
        if (dom == startDom && (dom.nodeType === 3 || dom.nodeType === 1 && dom.childNodes.length === 0)) {
            return dom;
        }

        //if previous node has child nodes, so find the last child node.
        var tmpD;
        tmpD = last(dom);
        if (!!dom && tmpD) {
            while (tmpD) {
                dom = tmpD;
                if (dom == startDom && (dom.nodeType === 3 || dom.nodeType === 1 && dom.childNodes.length === 0)) {
                    break;
                }
                tmpD = last(tmpD);
            }
        }

        return dom;
    },
    /**
     * 给 dom 内添加 Tab 时 获取 4 个 ' '
     */
    getTab: function getTab() {
        var x = _commonEnv2['default'].doc.createElement('span');
        x.innerHTML = '&nbsp;&nbsp;&nbsp;&nbsp;';
        return x.childNodes[0];
    },
    /**
     * 获取 td,th 单元格 在 table 中的 行列坐标
     * @param td
     */
    getTdIndex: function getTdIndex(td) {
        return {
            x: td.cellIndex,
            y: td.parentNode.rowIndex,
            maxX: td.parentNode.cells.length,
            maxY: td.parentNode.parentNode.rows.length
        };
    },
    getOffset: function getOffset(dom) {
        var offset = { top: 0, left: 0 };
        if (dom.offsetParent) {
            while (dom.offsetParent) {
                offset.top += dom.offsetTop;
                offset.left += dom.offsetLeft;
                dom = dom.offsetParent;
            }
        } else {
            offset.left += dom.offsetLeft;
            offset.top += dom.offsetTop;
        }
        return offset;
    },
    /**
     * 根据 dom 获取其 修订的父节点， 如果不是 修订内容，则返回空
     * @param dom
     * @returns {*}
     */
    getWizAmendParent: function getWizAmendParent(dom) {
        return domUtils.getParentByFilter(dom, function (node) {
            //node.childNodes.length == 0 时，键盘敲入的字符加在 span 外面
            return node && node.nodeType === 1 && (node.getAttribute(_commonConst2['default'].ATTR.SPAN_INSERT) || node.getAttribute(_commonConst2['default'].ATTR.SPAN_DELETE));
        }, true);
    },
    /**
     * 判断 dom 是否含有 某个 class name
     * @param obj
     * @param className
     * @returns {boolean}
     */
    hasClass: function hasClass(obj, className) {
        if (obj && obj.nodeType === 1) {
            return (' ' + obj.className + ' ').indexOf(' ' + className + ' ') > -1;
        }
        return false;
    },
    /**
     * wiz 编辑器使用的 插入 dom 方法（isAfter 默认为 false，即将 dom 插入到 target 前面）
     * @param target
     * @param dom
     * @param isAfter
     */
    before: function before(target, dom, isAfter) {
        isAfter = !!isAfter;
        if (!target || !dom) {
            return;
        }
        var isBody = target === _commonEnv2['default'].doc.body,
            parent = isBody ? target : target.parentNode,
            nextDom = isBody ? isAfter ? null : _commonEnv2['default'].doc.body.childNodes[0] : isAfter ? target.nextSibling : target;
        var i, d, last;
        if (!_commonUtils2['default'].isArray(dom)) {
            parent.insertBefore(dom, nextDom);
        } else {
            last = nextDom;
            for (i = dom.length - 1; i >= 0; i--) {
                d = dom[i];
                parent.insertBefore(d, last);
                last = d;
            }
        }
    },
    /**
     * 判断 dom 是否为 块级元素
     * @param dom
     * @returns {boolean}
     */
    isBlockDom: function isBlockDom(dom) {
        if (!dom) {
            return false;
        }
        // if (dom.nodeType == 9 || dom.nodeType == 11) {
        //     return true;
        // }
        var displayValue = domUtils.getComputedStyle(dom, 'display', false);
        return !!displayValue && !/^(inline|inline\-block|inline\-table|none)$/i.test(displayValue);
    },
    /**
     * 判断 dom 是否为 document.body
     * @param dom
     * @returns {*|boolean|boolean}
     */
    isBody: function isBody(dom) {
        return dom && dom == _commonEnv2['default'].doc.body;
    },
    /**
     * 判断 dom 是否为空（里面仅有 br 时 也被认为空）
     * @param dom
     * @returns {*}
     */
    isEmptyDom: function isEmptyDom(dom) {
        var i, j, v;
        if (dom.nodeType === 3) {
            v = dom.nodeValue;
            return _commonUtils2['default'].isEmpty(v);
        }

        if (dom.nodeType !== 1) {
            return true;
        }

        if (dom.childNodes.length === 0) {
            return domUtils.isTag(dom, 'br') || !domUtils.isSelfClosingTag(dom);
        }

        for (i = 0, j = dom.childNodes.length; i < j; i++) {
            if (!domUtils.isEmptyDom(dom.childNodes[i])) {
                return false;
            }
        }
        return true;
    },
    /**
     * 判断 dom 内容是否为 填充的特殊字符
     * @param node
     * @param isInStart
     * @returns {boolean}
     */
    isFillChar: function isFillChar(node, isInStart) {
        return node.nodeType == 3 && !node.nodeValue.replace(new RegExp((isInStart ? '^' : '') + _commonConst2['default'].FILL_CHAR), '').length;
    },
    /**
     * 判断 dom 是否为 行级元素
     * @param dom
     * @returns {boolean}
     */
    isInlineDom: function isInlineDom(dom) {
        return !domUtils.isBlockDom(dom);
    },
    /**
     * 判断 dom 是否为 自闭和标签 （主要用于清理冗余 dom 使用，避免 dom 被删除）
     * @param node
     * @returns {boolean}
     */
    isSelfClosingTag: function isSelfClosingTag(node) {
        var selfLib = /^(area|base|br|col|command|embed|hr|img|input|keygen|link|meta|param|source|track|wbr)$/i;
        return node.nodeType === 1 && selfLib.test(node.tagName);
    },
    /**
     * 判断两个 span 属性（style & attribute）是否相同（属性相同且相邻的两个 span 才可以合并）
     * @param n
     * @param m
     * @returns {boolean}
     */
    isSameSpan: function isSameSpan(n, m) {
        return !!n && !!m && n.nodeType == 1 && m.nodeType == 1 && domUtils.isTag(n, 'span') && n.tagName == m.tagName && n.getAttribute(_commonConst2['default'].ATTR.SPAN) == _commonConst2['default'].ATTR.SPAN && domUtils.isSameStyle(n, m) && domUtils.isSameAttr(n, m);
    },
    /**
     * 判断两个 dom 的 attribute 是否相同
     * @param n
     * @param m
     * @returns {boolean}
     */
    isSameAttr: function isSameAttr(n, m) {
        var attrA = n.attributes,
            attrB = m.attributes;
        if (attrA.length != attrB.length) {
            return false;
        }
        var i, j, a;
        for (i = 0, j = attrA.length; i < j; i++) {
            a = attrA[i];
            if (a.name == 'style') {
                continue;
            }
            if (a.name === _commonConst2['default'].ATTR.SPAN_TIMESTAMP) {
                if (!_commonUtils2['default'].isSameAmendTime(a.value, attrB[a.name].value)) {
                    return false;
                }
                continue;
            } else if (!attrB[a.name] || attrB[a.name].value != a.value) {
                return false;
            }
        }
        return true;
    },
    /**
     * 判断 dom 的 style （inline）是否相同
     * @param n
     * @param m
     */
    isSameStyle: function isSameStyle(n, m) {
        var styleA = {};
        var styleB = {};
        domUtils.appendStyle(n.getAttribute('style'), styleA);
        domUtils.appendStyle(m.getAttribute('style'), styleB);
        var k;
        for (k in styleA) {
            if (styleA.hasOwnProperty(k)) {
                if (styleB[k] !== styleA[k]) {
                    return false;
                }
                delete styleA[k];
                delete styleB[k];
            }
        }
        for (k in styleB) {
            if (styleB.hasOwnProperty(k)) {
                return false;
            }
        }
        return true;
    },
    /**
     * 判断 dom 是否为指定的 tagName
     * @param dom
     * @param tagNames
     * @returns {boolean}
     */
    isTag: function isTag(dom, tagNames) {
        if (!_commonUtils2['default'].isArray(tagNames)) {
            tagNames = [tagNames];
        }
        if (!dom || dom.nodeType !== 1) {
            return false;
        }
        var i,
            j,
            tag = dom.tagName.toLowerCase();
        for (i = 0, j = tagNames.length; i < j; i++) {
            if (tag === tagNames[i].toLowerCase()) {
                return true;
            }
        }
        return false;
    },
    /**
     * 判断 TextNode 内容是否为 非空 有效
     * @param node
     * @returns {boolean}
     */
    isUsableTextNode: function isUsableTextNode(node) {
        return node.nodeType == 3 && !_commonUtils2['default'].isEmpty(node.nodeValue);
    },
    /**
     * 判断 dom 是否为 wiz 编辑器 的 span
     * @param dom
     * @returns {boolean}
     */
    isWizSpan: function isWizSpan(dom) {
        return !!dom && !!dom.getAttribute(_commonConst2['default'].ATTR.SPAN);
    },
    /**
     * 把 domA 合并到 domB （仅合并 attribute 和 style）
     * @param objA
     * @param objB
     * @param isOverlay
     */
    mergeAtoB: function mergeAtoB(objA, objB, isOverlay) {
        domUtils.mergeStyleAToB(objA, objB, isOverlay);
        domUtils.mergeAttrAtoB(objA, objB, isOverlay);
    },
    /**
     * 把 domA 的属性（attribute） 合并到 domB
     * @param objA
     * @param objB
     * @param isOverlay
     */
    mergeAttrAtoB: function mergeAttrAtoB(objA, objB, isOverlay) {
        if (objA.nodeType != 1 || objB.nodeType != 1) {
            return;
        }
        var attrA = objA.attributes,
            attrB = objB.attributes,
            i,
            j,
            a;
        for (i = 0, j = attrA.length; i < j; i++) {
            a = attrA[i];
            if (a.name == 'style') {
                continue;
            }
            if (attrB[a.name] && !isOverlay) {
                continue;
            }
            objB.setAttribute(a.name, a.value);
        }
    },
    /**
     * 把 domA 的样式（style） 合并到 domB
     * @param objA
     * @param objB
     * @param isOverlay
     */
    mergeStyleAToB: function mergeStyleAToB(objA, objB, isOverlay) {
        if (objA.nodeType != 1 || objB.nodeType != 1) {
            return;
        }
        var sA = objA.getAttribute('style'),
            sB = objB.getAttribute('style') || '';
        if (!sA) {
            return;
        }
        var styleObj = {};
        if (!!isOverlay) {
            domUtils.appendStyle(sB, styleObj);
            domUtils.appendStyle(sA, styleObj);
        } else {
            domUtils.appendStyle(sA, styleObj);
            domUtils.appendStyle(sB, styleObj);
        }

        var result = [];
        for (var k in styleObj) {
            if (styleObj.hasOwnProperty(k)) {
                result.push(k + ':' + styleObj[k]);
            }
        }
        objB.setAttribute('style', result.join(';'));
    },
    /**
     * 移除 class name
     * @param domList
     * @param className
     */
    removeClass: function removeClass(domList, className) {
        if (!domList) {
            return;
        }
        if (!!domList.nodeType) {
            domList = [domList];
        }
        var i, dom;
        for (i = domList.length - 1; i >= 0; i--) {
            dom = domList[i];
            if (dom.nodeType === 1) {
                dom.className = (" " + dom.className + " ").replace(' ' + className + ' ', ' ').trim();
            }
        }
    },
    /**
     * 从 Dom 中清除指定 name 的 tag
     * @param name
     */
    removeDomByName: function removeDomByName(name) {
        var s = _commonEnv2['default'].doc.getElementsByName(name);
        var i, dom;
        for (i = s.length - 1; i >= 0; i--) {
            dom = s[i];
            dom.parentNode.removeChild(dom);
        }
    },
    /**
     * 从 Dom 中清除指定 的 tag
     * @param tag
     */
    removeDomByTag: function removeDomByTag(tag) {
        var s = _commonEnv2['default'].doc.getElementsByTagName(tag);
        var i, dom;
        for (i = s.length - 1; i >= 0; i--) {
            dom = s[i];
            dom.parentNode.removeChild(dom);
        }
    },
    /**
     * 从 html 源码中清除指定 name 的 style
     * 因为使用正则，不可能直接将 有嵌套 div 的div html 代码删除，所以此函数只能针对 style 等不会包含 html 代码的 tag 进行操作
     * @param html
     * @param name
     * @returns {string}
     */
    removeStyleByNameFromHtml: function removeStyleByNameFromHtml(html, name) {
        var reg = new RegExp('<style( ([^<>])+[ ]+|[ ]+)name *= *[\'"]' + name + '[\'"][^<>]*>[^<]*<\/style>', 'ig');
        return html.replace(reg, '');
    },
    /**
     * 从 html 源码中清除指定的 tag （注意，一定要保证该 tag 内不存在嵌套同样 tag 的情况）
     * @param html
     * @param tag
     * @returns {string}
     */
    removeDomByTagFromHtml: function removeDomByTagFromHtml(html, tag) {
        var reg = new RegExp('<' + tag + '([ ][^>]*)*>.*<\/' + tag + '>', 'ig');
        return html.replace(reg, '');
    },
    /**
     * 从 dom 集合中删除符合特殊规则的 dom
     * @param domList
     * @param filter
     * @returns {Array} 返回被删除的集合列表
     */
    removeListFilter: function removeListFilter(domList, filter) {
        var removeList = [],
            i,
            dom;

        if (!domList || !filter) {
            return removeList;
        }

        for (i = domList.length - 1; i >= 0; i--) {
            dom = domList[i];
            if (filter(dom)) {
                removeList.unshift(domList.splice(i, 1)[0]);
            }
        }
        return removeList;
    },
    /**
     * 根据 查询表达式 查找 dom，并放到 list 集合内
     * @param dom
     * @param expStr
     * @param list
     */
    search: function search(dom, expStr, list) {
        //TODO 兼容问题
        var tmpList = dom.querySelectorAll(expStr),
            i,
            j,
            d;
        list = list ? list : [];
        for (i = 0, j = tmpList.length; i < j; i++) {
            d = tmpList[i];
            list.push(d);
        }
    },
    /**
     * 设置区域可编辑
     * @param content
     * @param enable
     */
    setContenteditable: function setContenteditable(content, enable) {
        if (!content && _commonEnv2['default'].win.WizTemplate) {
            _commonEnv2['default'].win.WizTemplate.setContenteditable(enable);
        } else {
            if (!content) {
                content = _commonEnv2['default'].doc.body;
            }
            content.setAttribute('contenteditable', enable ? 'true' : 'false');
        }
    },
    /**
     * 自动布局（根据 target 的位置 以及 屏幕大小，设置 layerObj 的坐标，保证在可视区域内显示）
     * @param options
     * {layerObj, target, layout, fixed, noSpace, reverse}
     */
    setLayout: function setLayout(options) {
        var layerObj = options.layerObj,
            target = options.target,
            layout = options.layout,
            fixed = !!options.fixed,
            noSpace = !!options.noSpace,
            reverse = !!options.reverse;

        var confirmPos = domUtils.getDomPosition(layerObj),
            targetPos = target.nodeType ? domUtils.getDomPosition(target) : target,
            scrollPos = domUtils.getPageScroll(),
            winWidth = _commonEnv2['default'].doc.documentElement.clientWidth,
            winHeight = _commonEnv2['default'].doc.documentElement.clientHeight,
            bodyTop = window.getComputedStyle ? _commonEnv2['default'].win.getComputedStyle(_commonEnv2['default'].doc.body, null)['margin-top'] : 0,
            left = '50%',
            top = '30%',
            mTop = 0,
            mLeft = -confirmPos.width / 2,
            minWidth,
            maxWidth,
            minHeight,
            maxHeight;

        //iphone 客户端 编辑时 window 窗口顶端有其他 window 遮罩， 所以必须要计算 body 的 margin-top
        if (!!bodyTop) {
            bodyTop = parseInt(bodyTop);
            if (isNaN(bodyTop)) {
                bodyTop = 0;
            }
        }

        if (fixed) {
            minWidth = 0;
            maxWidth = winWidth - 5; //右侧需要保留一些空间，避免有时候超出
            minHeight = 0 + bodyTop;
            maxHeight = winHeight;
        } else {
            minWidth = 0 + scrollPos.left;
            maxWidth = winWidth + scrollPos.left - 5; //右侧需要保留一些空间，避免有时候超出
            minHeight = 0 + (scrollPos.top <= bodyTop ? 0 : Math.abs(scrollPos.top - bodyTop)) + bodyTop;
            maxHeight = winHeight + scrollPos.top;
        }

        if (targetPos && layout) {
            mTop = 0;
            mLeft = 0;
            if (layout == _commonConst2['default'].TYPE.POS.upLeft || layout == _commonConst2['default'].TYPE.POS.upRight) {
                top = targetPos.top - confirmPos.height - (noSpace ? 0 : _commonConst2['default'].AMEND.INFO_SPACE);
            } else if (layout == _commonConst2['default'].TYPE.POS.downLeft || layout == _commonConst2['default'].TYPE.POS.downRight) {
                top = targetPos.top + targetPos.height + (noSpace ? 0 : _commonConst2['default'].AMEND.INFO_SPACE);
            } else if (layout == _commonConst2['default'].TYPE.POS.leftUp || layout == _commonConst2['default'].TYPE.POS.leftDown) {
                left = targetPos.left - confirmPos.width - (noSpace ? 0 : _commonConst2['default'].AMEND.INFO_SPACE);
            } else if (layout == _commonConst2['default'].TYPE.POS.rightUp || layout == _commonConst2['default'].TYPE.POS.rightDown) {
                left = targetPos.left + targetPos.width + (noSpace ? 0 : _commonConst2['default'].AMEND.INFO_SPACE);
            }

            if (layout == _commonConst2['default'].TYPE.POS.upLeft || layout == _commonConst2['default'].TYPE.POS.downLeft) {
                left = targetPos.left;
                if (fixed) {
                    left -= scrollPos.left;
                }
            } else if (layout == _commonConst2['default'].TYPE.POS.upRight || layout == _commonConst2['default'].TYPE.POS.downRight) {
                left = targetPos.left + targetPos.width - confirmPos.width;
                if (fixed) {
                    left -= scrollPos.left;
                }
            } else if (layout == _commonConst2['default'].TYPE.POS.leftUp || layout == _commonConst2['default'].TYPE.POS.rightUp) {
                top = targetPos.top;
                if (fixed) {
                    top -= scrollPos.top;
                }
            } else if (layout == _commonConst2['default'].TYPE.POS.leftDown || layout == _commonConst2['default'].TYPE.POS.rightDown) {
                top = targetPos.top + targetPos.height - confirmPos.height;
                if (fixed) {
                    top -= scrollPos.top;
                }
            }

            if (left + confirmPos.width > maxWidth) {
                left = maxWidth - confirmPos.width;
            }
            if (left < minWidth) {
                left = minWidth;
            }
            if (top + confirmPos.height > maxHeight) {
                top = maxHeight - confirmPos.height;
            }
            if (reverse && top < minHeight) {
                top = targetPos.top + targetPos.height;
            }
            if (top < minHeight || top + confirmPos.height > maxHeight) {
                top = minHeight;
            }
        }
        domUtils.css(layerObj, {
            left: left + 'px',
            top: top + 'px',
            'margin-top': mTop + 'px',
            'margin-left': mLeft + 'px'
        }, false);
    },

    /**
     * 根据 光标选择范围 拆分 textNode
     * splitRangeText 不能返回 TextNode，所以在 wizSpan 内要把 TextNode 独立分割出来，然后返回其 parentNode
     * @param node
     * @param start
     * @param end
     * @returns {*}
     */
    splitRangeText: function splitRangeText(node, start, end) {
        if (!domUtils.isUsableTextNode(node)) {
            return node;
        }
        var p,
            s,
            t,
            v = node.nodeValue;
        p = node.parentNode;
        //            var isWizSpan = domUtils.isWizSpan(p);
        s = domUtils.createSpan();

        if (!start && !end || start === 0 && end === node.nodeValue.length) {
            //the range is all text in this node
            // td,th 必须特殊处理，否则会导致 td 被添加 修订样式
            if (p.childNodes.length > 1 || domUtils.isTag(p, ['td', 'th'])) {
                p.insertBefore(s, node);
                s.appendChild(node);
            } else {
                //if textNode is the only child node, return its parent node.
                s = p;
            }
        } else if (start === 0) {
            //the range is [0, n] (n<length)
            p.insertBefore(s, node);
            s.innerText = v.substring(start, end);
            node.nodeValue = v.substring(end);
        } else if (!end || end === node.nodeValue.length) {
            p.insertBefore(s, node.nextSibling);
            s.innerText = v.substring(start);
            node.nodeValue = v.substring(0, start);
        } else {
            //the range is [m, n] (m>0 && n<length)
            t = _commonEnv2['default'].doc.createTextNode(v.substring(end));
            p.insertBefore(s, node.nextSibling);
            s.innerText = v.substring(start, end);
            p.insertBefore(t, s.nextSibling);
            //必须要先添加文字，最后删除多余文字，否则，如果先删除后边文字，会导致滚动条跳动
            node.nodeValue = v.substring(0, start);
        }
        return s;
    },
    /**
     * 将 dom 剥壳
     * @param dom
     */
    stripDom: function stripDom(dom, checkFun) {
        if (!dom) {
            return;
        }
        var result = {
            start: null,
            end: null
        };
        var childNodes, child, i;
        childNodes = dom.childNodes;
        for (i = childNodes.length - 1; i >= 0; i--) {
            child = childNodes[i];
            if (!checkFun || checkFun(child)) {
                domUtils.before(dom, child, true);
                if (!result.start) {
                    result.start = child;
                    result.end = child;
                } else {
                    result.end = child;
                }
            }
        }
        dom.parentNode.removeChild(dom);
        return result;
    }
};

exports['default'] = domUtils;
module.exports = exports['default'];

},{"./../common/const":13,"./../common/env":15,"./../common/utils":19}],24:[function(require,module,exports){
/**
 * DOM 操作工具包（扩展类库）
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('./../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('./../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('./../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _domBase = require('./domBase');

var _domBase2 = _interopRequireDefault(_domBase);

/**
 * 清理无用的 子节点 span ，合并 attribute & style 相同的 span
 * @param dom
 * @param excludeList
 */
_domBase2['default'].clearChild = function (dom, excludeList) {
    if (!dom) {
        return;
    }
    var isExclude = excludeList.indexOf(dom) >= 0;
    if (!isExclude && dom.nodeType == 3 && !_domBase2['default'].isUsableTextNode(dom)) {
        dom.parentNode.removeChild(dom);
        return;
    } else if (!isExclude && dom.nodeType == 3) {
        dom.nodeValue = dom.nodeValue.replace(_commonConst2['default'].FILL_CHAR_REG, '');
        return;
    }

    if (!isExclude && dom.nodeType == 1) {
        var ns = dom.childNodes,
            i,
            item;
        for (i = ns.length - 1; i >= 0; i--) {
            item = ns[i];
            _domBase2['default'].clearChild(item, excludeList);
        }
        _domBase2['default'].mergeChildSpan(dom, excludeList);

        if (excludeList.indexOf(dom) < 0 && dom.childNodes.length === 0 && dom.nodeType == 1 && !_domBase2['default'].isSelfClosingTag(dom) &&
        //                    dom.tagName.toLowerCase() == 'span' && !!dom.getAttribute(CONST.ATTR.SPAN)) {
        !!dom.getAttribute(_commonConst2['default'].ATTR.SPAN)) {
            dom.parentNode.removeChild(dom);
        }
    }
};
/**
 * 获取 body 内的 innerText
 * @returns {*}
 */
_domBase2['default'].getBodyText = function () {
    var body = _commonEnv2['default'].doc.body;
    if (!body) return " ";
    return body.innerText ? body.innerText : '';
};
/**
 * 获取当前页面源码
 * @returns {*}
 */
_domBase2['default'].getContentHtml = function () {
    _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.BEFORE_GET_DOCHTML, null);

    var docType = _domBase2['default'].getDocType(_commonEnv2['default'].doc);

    //将 input text、textarea 的内容设置到 html 内
    var i, j, obj, textType;
    var objList = _commonEnv2['default'].doc.getElementsByTagName('input');
    for (i = 0, j = objList.length; i < j; i++) {
        obj = objList[i];
        if (/^test$/i.test(obj.getAttribute('type')) && obj.value !== obj.getAttribute('value')) {
            obj.setAttribute('value', obj.value);
        }
    }
    objList = _commonEnv2['default'].doc.getElementsByTagName('textarea');
    for (i = 0, j = objList.length; i < j; i++) {
        obj = objList[i];
        textType = obj.innerText === undefined ? 'textContent' : 'innerText';
        if (obj.value !== obj[textType]) {
            obj[textType] = obj.value;
        }
    }
    //处理 table 容器内 table 之外的内容
    objList = _commonEnv2['default'].doc.querySelectorAll('.' + _commonConst2['default'].CLASS.TABLE_CONTAINER);
    for (i = 0, j = objList.length; i < j; i++) {
        _domBase2['default'].moveOutFromTableContainer(objList[i]);
    }

    var content = _domBase2['default'].removeStyleByNameFromHtml(_commonEnv2['default'].doc.documentElement.outerHTML, _commonConst2['default'].NAME.TMP_STYLE);
    content = _domBase2['default'].removeDomByTagFromHtml(content, _commonConst2['default'].TAG.TMP_TAG);

    //移除 script
    content = content.replace(/<script[^<>]*\/>/ig, '').replace(/<script[^<>]*>(((?!<\/script>).)|(\r?\n))*<\/script>/ig, '');

    //需要兼容 WizTemplate 中的部分区域可编辑 状态
    //var bodyReg = /(<body( [^<>]*)*)[ ]+contenteditable[ ]*=[ ]*['"][^'"<>]*['"]/ig;
    var bodyReg = /(<[\w]*[^<>]*[ ]+)contenteditable([ ]*=[ ]*['"][^'"<>]*['"])?/ig;
    content = content.replace(bodyReg, '$1');

    content = _domBase2['default'].hideTableFromHtml(content);

    //过滤其他插件
    if (_commonEnv2['default'].win.WizTemplate) {
        content = _commonEnv2['default'].win.WizTemplate.hideTemplateFormHtml(content);
    }
    return docType + content;
};
/**
 * 针对 html 源码隐藏表格的高亮信息，主要用于保存操作
 * @param html
 * @returns {*}
 */
_domBase2['default'].hideTableFromHtml = function (html) {
    //做 RegExp 做 test 的时候 不能使用 g 全局设置， 否则会影响 索引
    var regexForTest = /(<[^<> ]*[^<>]* class[ ]*=[ ]*['"])([^'"]*)(['"])/i;
    var regex = /(<[^<> ]*[^<>]* class[ ]*=[ ]*['"])([^'"]*)(['"])/ig;
    if (!regexForTest.test(html)) {
        return html;
    }

    var result = [],
        m,
        lastIndex = 0,
        str,
        reg;
    while (m = regex.exec(html)) {
        str = m[2];

        //先处理 float layer
        if ((' ' + str + ' ').indexOf(' ' + _commonConst2['default'].CLASS.SELECTED_CELL + ' ') > -1) {
            reg = new RegExp(' ' + _commonConst2['default'].CLASS.SELECTED_CELL + ' ', 'ig');
            str = (' ' + str + ' ').replace(reg, '').trim();
        }

        result.push(html.substr(lastIndex, m.index - lastIndex), m[1], str, m[3]);

        lastIndex = m.index + m[0].length;
        //console.log(m);
    }
    result.push(html.substr(lastIndex));
    return result.join('');
};
/**
 * 合并 子节点中相邻且相同（style & attribute ）的 span
 * merge the same span with parent and child nodes.
 * @param dom
 * @param excludeList
 */
_domBase2['default'].mergeChildSpan = function (dom, excludeList) {
    if (!dom || dom.nodeType !== 1) {
        return;
    }
    var i, j;
    for (i = 0, j = dom.children.length; i < j; i++) {
        _domBase2['default'].mergeChildSpan(dom.children[i], excludeList);
    }
    _domBase2['default'].mergeSiblingSpan(dom, excludeList);

    var n = dom.children[0],
        tmp;
    if (!!n && excludeList.indexOf(n) < 0 && dom.childNodes.length == 1 && dom.getAttribute(_commonConst2['default'].ATTR.SPAN) == _commonConst2['default'].ATTR.SPAN && n.getAttribute(_commonConst2['default'].ATTR.SPAN) == _commonConst2['default'].ATTR.SPAN) {
        _domBase2['default'].mergeChildToParent(dom, n);
    } else {
        while (!!n) {
            if (excludeList.indexOf(n) < 0 && excludeList.indexOf(dom) < 0 && _domBase2['default'].isSameSpan(dom, n)) {
                tmp = n.previousElementSibling;
                _domBase2['default'].mergeChildToParent(dom, n);
                n = tmp ? tmp.nextElementSibling : dom.children[0];
            } else {
                n = n.nextElementSibling;
            }
        }
    }
};
/**
 * 将 子节点 合并到 父节点 （主要用于 嵌套的 span 合并）
 * @param parent
 * @param child
 */
_domBase2['default'].mergeChildToParent = function (parent, child) {
    if (!parent || !child || child.parentNode !== parent) {
        return;
    }
    while (child.childNodes.length > 0) {
        _domBase2['default'].before(child, child.childNodes[0], false);
    }
    _domBase2['default'].mergeAtoB(parent, child, false);
    _domBase2['default'].mergeAtoB(child, parent, true);
    parent.removeChild(child);
};
/**
 * 合并相邻且相同（style & attribute ）的 span
 * @param parentDom
 * @param excludeList
 */
_domBase2['default'].mergeSiblingSpan = function (parentDom, excludeList) {
    var n = parentDom.childNodes[0],
        m,
        tmp;
    if (!n) {
        return;
    }
    while (n) {
        m = n.nextSibling;
        if (m && excludeList.indexOf(m) < 0 && excludeList.indexOf(n) < 0 && _domBase2['default'].isSameSpan(n, m)) {
            while (m.childNodes.length) {
                tmp = m.childNodes[0];
                if (tmp && (tmp.innerHTML || tmp.nodeValue && tmp.nodeValue != _commonConst2['default'].FILL_CHAR)) {
                    n.appendChild(tmp);
                } else {
                    m.removeChild(tmp);
                }
            }
            m.parentNode.removeChild(m);
        } else {
            n = m;
        }
    }
};
_domBase2['default'].modifyChildNodesStyle = function (dom, style, attr) {
    if (!dom) {
        return;
    }
    var ns = dom.childNodes,
        done = false,
        i,
        item;
    for (i = 0; i < ns.length; i++) {
        item = ns[i];
        if (!done && _domBase2['default'].isUsableTextNode(item)) {
            done = true;
            _domBase2['default'].modifyStyle(dom, style, attr);
        } else if (item.nodeType == 1) {
            _domBase2['default'].modifyChildNodesStyle(item, style, attr);
        }
    }
};
_domBase2['default'].modifyNodeStyle = function (item, style, attr) {
    if (item.nodeType == 1) {
        if (_domBase2['default'].isSelfClosingTag(item)) {
            _domBase2['default'].modifyStyle(item, style, attr);
        } else {
            _domBase2['default'].modifyChildNodesStyle(item, style, attr);
        }
    } else if (_domBase2['default'].isUsableTextNode(item)) {
        item = _domBase2['default'].splitRangeText(item, null, null);
        _domBase2['default'].modifyStyle(item, style, attr);
    }
    return item;
};
/**
 * 修改 集合中所有Dom 的样式（style） & 属性（attribute）
 * @param domList
 * @param style
 * @param attr
 */
_domBase2['default'].modifyNodesStyle = function (domList, style, attr) {
    if (domList.length === 0) {
        return;
    }
    var i, j, item;
    for (i = 0, j = domList.length; i < j; i++) {
        item = domList[i];
        domList[i] = _domBase2['default'].modifyNodeStyle(item, style, attr);
    }
};
/**
 * 修改 Dom 的样式（style） & 属性（attribute）
 * @param dom
 * @param style
 * @param attr
 */
_domBase2['default'].modifyStyle = function (dom, style, attr) {

    var isSelfClosingTag = _domBase2['default'].isSelfClosingTag(dom);
    //自闭合标签 不允许设置 新增的修订标识
    if (attr && attr[_commonConst2['default'].ATTR.SPAN_INSERT] && isSelfClosingTag) {
        return;
    }

    var d = dom;

    if (attr && (attr[_commonConst2['default'].ATTR.SPAN_INSERT] || attr[_commonConst2['default'].ATTR.SPAN_DELETE])) {
        //如果 dom 是 修订的内容， 且设定修订内容 则必须要针对 修订DOM 处理
        d = _domBase2['default'].getWizAmendParent(dom);
        if (!d) {
            d = dom;
        } else {
            dom = null;
        }
    }

    if (!!dom && !isSelfClosingTag && (!_domBase2['default'].isTag(dom, 'span') || dom.getAttribute(_commonConst2['default'].ATTR.SPAN) !== _commonConst2['default'].ATTR.SPAN)) {
        d = _domBase2['default'].createSpan();
        dom.insertBefore(d, null);
        while (dom.childNodes.length > 1) {
            d.insertBefore(dom.childNodes[0], null);
        }
    }
    _domBase2['default'].css(d, style, false);
    _domBase2['default'].attr(d, attr);
};
/**
 * 将 table 容器内 非 table 内容移出
 * @param container
 */
_domBase2['default'].moveOutFromTableContainer = function (container) {
    if (!container) {
        return;
    }

    move(container, container);
    move(container, container.querySelector('.' + _commonConst2['default'].CLASS.TABLE_BODY));

    function move(mainDom, _container) {
        var childList,
            dom,
            i,
            before = false;
        childList = _container.childNodes;
        for (i = childList.length - 1; i >= 0; i--) {
            dom = childList[i];
            if (dom.nodeType === 1 && (_domBase2['default'].hasClass(dom, _commonConst2['default'].CLASS.TABLE_BODY) || _domBase2['default'].isTag(dom, ['table', _commonConst2['default'].TAG.TMP_TAG]))) {
                if (_domBase2['default'].hasClass(dom, _commonConst2['default'].CLASS.TABLE_BODY) || _domBase2['default'].isTag(dom, 'table')) {
                    before = true;
                }
                continue;
            }
            _domBase2['default'].before(mainDom, dom, !before);
        }
    }
};
/**
 * 在删除 当前用户已删除 指定的Dom 后， 判断其 parentNode 是否为空，如果为空，继续删除
 * @param pDom
 */
_domBase2['default'].removeEmptyParent = function (pDom) {
    if (!pDom) {
        return;
    }
    var p;
    if (_domBase2['default'].isEmptyDom(pDom)) {
        if (pDom === _commonEnv2['default'].doc.body || _domBase2['default'].isTag(pDom, ['td', 'th'])) {
            //如果 pDom 为 body | td | th 且为空， 则添加 br 标签
            pDom.innerHTML = '<br/>';
        } else {
            p = pDom.parentNode;
            if (p) {
                p.removeChild(pDom);
                _domBase2['default'].removeEmptyParent(p);
            }
        }
    }
};

/**
 * 将 mainDom 以子节点 subDom 为分割点 分割为两个 mainDom（用于 修订处理）
 * @param mainDom
 * @param subDom
 */
_domBase2['default'].splitDom = function (mainDom, subDom) {
    if (!mainDom || !subDom || !subDom.previousSibling) {
        return;
    }
    var p = mainDom.parentNode,
        m2 = mainDom.cloneNode(false),
        next;
    while (subDom) {
        next = subDom.nextSibling;
        m2.appendChild(subDom);
        subDom = next;
    }
    p.insertBefore(m2, mainDom.nextSibling);
};

exports['default'] = _domBase2['default'];
module.exports = exports['default'];

},{"./../common/const":13,"./../common/env":15,"./../common/utils":19,"./domBase":23}],25:[function(require,module,exports){
/**
 * 编辑器 基础工具包
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _commonDependLoader = require('../common/dependLoader');

var _commonDependLoader2 = _interopRequireDefault(_commonDependLoader);

var _commonHistoryUtils = require('../common/historyUtils');

var _commonHistoryUtils2 = _interopRequireDefault(_commonHistoryUtils);

var _domUtilsDomExtend = require('../domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

var _rangeUtilsRangeExtend = require('../rangeUtils/rangeExtend');

var _rangeUtilsRangeExtend2 = _interopRequireDefault(_rangeUtilsRangeExtend);

var _todoUtilsTodoCore = require('../todoUtils/todoCore');

var _todoUtilsTodoCore2 = _interopRequireDefault(_todoUtilsTodoCore);

var _tableUtilsTableCore = require('../tableUtils/tableCore');

var _tableUtilsTableCore2 = _interopRequireDefault(_tableUtilsTableCore);

var _tableUtilsTableUtils = require('../tableUtils/tableUtils');

var _tableUtilsTableUtils2 = _interopRequireDefault(_tableUtilsTableUtils);

var _tableUtilsTableZone = require('../tableUtils/tableZone');

var _tableUtilsTableZone2 = _interopRequireDefault(_tableUtilsTableZone);

var _imgUtilsImgUtils = require('../imgUtils/imgUtils');

var _imgUtilsImgUtils2 = _interopRequireDefault(_imgUtilsImgUtils);

var _amendAmendUtilsAmendExtend = require('../amend/amendUtils/amendExtend');

var _amendAmendUtilsAmendExtend2 = _interopRequireDefault(_amendAmendUtilsAmendExtend);

var _amendAmendUser = require('../amend/amendUser');

var _amendAmendUser2 = _interopRequireDefault(_amendAmendUser);

var _amendAmend = require('../amend/amend');

var _amendAmend2 = _interopRequireDefault(_amendAmend);

var _commonWizStyle = require('../common/wizStyle');

var _commonWizStyle2 = _interopRequireDefault(_commonWizStyle);

var _editorEvent = require('./editorEvent');

var _editorEvent2 = _interopRequireDefault(_editorEvent);

var _tabKey = require('./tabKey');

var _tabKey2 = _interopRequireDefault(_tabKey);

var originalHtml = '';
var editor = {
    init: function init() {},
    on: function on() {
        _commonDependLoader2['default'].loadCss(_commonEnv2['default'].doc, [_commonEnv2['default'].dependency.files.css.fonts]);
        _domUtilsDomExtend2['default'].setContenteditable(null, true);
        _commonEnv2['default'].readonly = false;
        _commonWizStyle2['default'].insertTmpEditorStyle();

        _editorEvent2['default'].bind();
        _imgUtilsImgUtils2['default'].on();
        _tableUtilsTableCore2['default'].on();
        _tabKey2['default'].on();
        _todoUtilsTodoCore2['default'].on();

        _amendAmend2['default'].startReverse();
        _commonHistoryUtils2['default'].start(_commonEnv2['default'].options.maxRedo, _commonEnv2['default'].options.callback.redo);

        setTimeout(function () {
            editor.setOriginalHtml();
        }, 1000);
    },
    off: function off() {
        _commonHistoryUtils2['default'].stop();
        _amendAmend2['default'].stopReverse();
        _amendAmend2['default'].stop();
        _todoUtilsTodoCore2['default'].off();
        _tabKey2['default'].off();
        _tableUtilsTableCore2['default'].off();
        _imgUtilsImgUtils2['default'].off();
        _editorEvent2['default'].unbind();

        _commonEnv2['default'].readonly = true;
        _domUtilsDomExtend2['default'].setContenteditable(null, false);
        _domUtilsDomExtend2['default'].removeDomByName(_commonConst2['default'].NAME.TMP_STYLE);
        _domUtilsDomExtend2['default'].removeDomByTag(_commonConst2['default'].TAG.TMP_TAG);
    },
    getOriginalHtml: function getOriginalHtml() {
        return originalHtml;
    },
    insertDefaultStyle: function insertDefaultStyle(isReplace, customCss) {
        _commonWizStyle2['default'].insertDefaultStyle(isReplace, customCss);
    },
    insertDom: function insertDom(dom) {
        if (!dom) {
            return;
        }
        var tmpDom = readyForInsert(),
            i,
            j,
            lastDom;
        //console.log(tmpDom);

        if (_commonUtils2['default'].isArray(dom)) {
            for (i = 0, j = dom.length; i < j; i++) {
                tmpDom.parent.insertBefore(dom[i], tmpDom.target);
                lastDom = dom[i];
            }
        } else {
            tmpDom.parent.insertBefore(dom, tmpDom.target);
            lastDom = dom;
        }
        afterInsert(lastDom);
    },
    insertHtml: function insertHtml(html) {
        if (!html) {
            return;
        }
        var template = _commonEnv2['default'].doc.createElement('div'),
            i,
            j,
            doms = [];
        template.innerHTML = html;
        for (i = 0, j = template.childNodes.length; i < j; i++) {
            doms.push(template.childNodes[i]);
        }
        editor.insertDom(doms);
        template = null;
    },
    modifySelectionDom: function modifySelectionDom(style, attr) {
        var range = _rangeUtilsRangeExtend2['default'].getRange(),
            zone = _tableUtilsTableZone2['default'].getZone();

        var align, valign;
        if ((!range || range.collapsed) && zone.range) {
            //处理单元格样式
            align = style['text-align'] || null;
            valign = style['text-valign'] || null;
            delete style['text-align'];
            delete style['text-valign'];

            _tableUtilsTableUtils2['default'].eachRange(zone.grid, zone.range, function (cellData) {
                if (!cellData.fake) {
                    _rangeUtilsRangeExtend2['default'].modifyDomsStyle(cellData.cell.childNodes, style, attr, []);
                }
            });
            if (align || valign) {
                _tableUtilsTableUtils2['default'].setCellAlign(zone.grid, zone.range, {
                    align: align,
                    valign: valign
                });
            }
            return;
        }
        // 处理普通文本样式
        _rangeUtilsRangeExtend2['default'].modifySelectionDom(style, attr);
    },
    setOriginalHtml: function setOriginalHtml() {
        originalHtml = _domUtilsDomExtend2['default'].getContentHtml();
    }
};

/**
 * 插入内容前准备工作
 */
function readyForInsert() {
    var sel = _commonEnv2['default'].doc.getSelection(),
        range = _rangeUtilsRangeExtend2['default'].getRange(),
        startDom,
        startOffset,
        result = {
        parent: null,
        target: null
    };

    if (!range) {
        //如果页面没有焦点， 则尝试恢复光标位置， 失败后自动让 body 获取焦点
        if (!_rangeUtilsRangeExtend2['default'].restoreCaret()) {
            _domUtilsDomExtend2['default'].focus();
        }
    }

    if (_amendAmend2['default'].isAmendEditing()) {
        //修订编辑模式下，先做修订的删除操作
        if (!range.collapsed) {
            _amendAmendUtilsAmendExtend2['default'].removeSelection(_amendAmendUser2['default'].getCurUser());
            _amendAmendUtilsAmendExtend2['default'].removeUserDel(null, _amendAmendUser2['default'].getCurUser());
            sel.collapseToEnd();
        }
    }

    //TODO 目前暂不考虑 插入 dom 和 html 时进行修订处理，仅保证不影响修订dom
    var fixed = _amendAmendUtilsAmendExtend2['default'].fixedAmendRange();
    var newDom = _amendAmend2['default'].splitAmendDomByRange(fixed);

    range = _rangeUtilsRangeExtend2['default'].getRange();
    startDom = range.startContainer;
    startOffset = range.startOffset;

    if (newDom) {
        //直接找到新节点位置
        result.target = newDom;
        result.parent = newDom.parentNode;
    } else if (startDom.nodeType == 3 && startOffset > 0 && startOffset < startDom.nodeValue.length) {
        //处于 textNode 的中间
        result.target = _domUtilsDomExtend2['default'].splitRangeText(startDom, startOffset, null);
        result.parent = result.target.parentNode;
    } else if (startDom.nodeType == 1 && startOffset > 0 && startOffset < startDom.childNodes.length) {
        //处于 element 节点中间
        result.target = startDom.childNodes[startOffset];
        result.parent = startDom;
    } else if (startDom == _commonEnv2['default'].doc.body || startDom == _commonEnv2['default'].doc.body.parentNode) {
        //处于 body 的根位置
        result.target = startOffset === 0 ? _commonEnv2['default'].doc.body.childNodes[0] : null;
        result.parent = _commonEnv2['default'].doc.body;
    } else if (startOffset === 0) {
        //处于 某 dom 的开始
        result.target = startDom;
        result.parent = startDom.parentNode;
    } else if (startDom.nodeType === 3) {
        //处于 textNode 的结尾
        result.target = startDom.nextSibling;
        result.parent = startDom.parentNode;
    } else {
        //处于 element 的结尾
        result.target = null;
        result.parent = startDom;
    }

    //如果下一个是 element 节点，并且为空， 则直接将内容写入到 该 element 内
    //主要针对 <div><br/></div>
    if (result.target && result.target.nodeType === 1 && !_domUtilsDomExtend2['default'].isSelfClosingTag(result.target) && _domUtilsDomExtend2['default'].isEmptyDom(result.target)) {
        result.parent = result.target;
        result.target = result.parent.childNodes[0];
    }

    return result;
}

/**
 * 插入内容后 设置光标到插入内容结尾，并滚动到视图
 * @param lastNode
 */
var afterInsertTimer;
function afterInsert(lastNode) {
    //Preserve the selection
    if (!lastNode) {
        return;
    }
    if (afterInsertTimer) {
        clearTimeout(afterInsertTimer);
    }
    var rangTimer = 30,
        scrollTimer = 30;

    //if (ENV.client.type.isPhone) {
    //    rangTimer = 100;
    //    scrollTimer = 50;
    //}

    afterInsertTimer = setTimeout(function () {
        var start,
            target = lastNode;
        if (_domUtilsDomExtend2['default'].isSelfClosingTag(lastNode)) {
            target = target.parentNode;
            start = _domUtilsDomExtend2['default'].getDomIndex(lastNode) + 1;
        } else {
            start = _domUtilsDomExtend2['default'].getDomEndOffset(lastNode);
        }

        if (_domUtilsDomExtend2['default'].isEmptyDom(target)) {
            //避免 br 堆积
            start = 0;
        }

        _rangeUtilsRangeExtend2['default'].setRange(target, start, null, null);

        if (lastNode.nodeType === 1) {
            afterInsertTimer = setTimeout(function () {
                lastNode.scrollIntoViewIfNeeded();
            }, scrollTimer);
        }
    }, rangTimer);
}

exports['default'] = editor;
module.exports = exports['default'];

},{"../amend/amend":7,"../amend/amendUser":9,"../amend/amendUtils/amendExtend":11,"../common/const":13,"../common/dependLoader":14,"../common/env":15,"../common/historyUtils":16,"../common/utils":19,"../common/wizStyle":20,"../domUtils/domExtend":24,"../imgUtils/imgUtils":29,"../rangeUtils/rangeExtend":36,"../tableUtils/tableCore":39,"../tableUtils/tableUtils":41,"../tableUtils/tableZone":42,"../todoUtils/todoCore":43,"./editorEvent":26,"./tabKey":27}],26:[function(require,module,exports){
/**
 * editor 使用的基本事件处理
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonLang = require('../common/lang');

var _commonLang2 = _interopRequireDefault(_commonLang);

var _commonUtils = require('../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _commonHistoryUtils = require('../common/historyUtils');

var _commonHistoryUtils2 = _interopRequireDefault(_commonHistoryUtils);

var _domUtilsDomBase = require('../domUtils/domBase');

var _domUtilsDomBase2 = _interopRequireDefault(_domUtilsDomBase);

var _rangeUtilsRangeExtend = require('../rangeUtils/rangeExtend');

var _rangeUtilsRangeExtend2 = _interopRequireDefault(_rangeUtilsRangeExtend);

var _tableUtilsTableCore = require('../tableUtils/tableCore');

var _tableUtilsTableCore2 = _interopRequireDefault(_tableUtilsTableCore);

var _tableUtilsTableZone = require('../tableUtils/tableZone');

var _tableUtilsTableZone2 = _interopRequireDefault(_tableUtilsTableZone);

var _tableUtilsTableUtils = require('../tableUtils/tableUtils');

var _tableUtilsTableUtils2 = _interopRequireDefault(_tableUtilsTableUtils);

var _amendAmend = require('../amend/amend');

var _amendAmend2 = _interopRequireDefault(_amendAmend);

var _amendAmendUser = require('../amend/amendUser');

var _amendAmendUser2 = _interopRequireDefault(_amendAmendUser);

var _amendAmendUtilsAmendExtend = require('../amend/amendUtils/amendExtend');

var _amendAmendUtilsAmendExtend2 = _interopRequireDefault(_amendAmendUtilsAmendExtend);

var EditorEventType = {
    SelectionChange: 'selectionchange'
},
    editorListener = {
    selectionchange: []
};

var eventTrackHandler = {},
    selectTimer = null;

/**
 * 获取光标位置 文字样式
 */
function getCaretStyle() {
    if (selectTimer) {
        clearTimeout(selectTimer);
    }

    var range = _rangeUtilsRangeExtend2['default'].getRange(),
        zone = _tableUtilsTableZone2['default'].getZone();

    if (!range && !zone.range || zone.active) {
        return;
    }
    selectTimer = setTimeout(_getCaretStyle, 300);
}
function _getCaretStyle() {
    var result = {
        'blockFormat': '',
        'canCreateTable': '1',
        'fontSize': '',
        'fontName': '',
        'foreColor': '',
        'backColor': '',
        'bold': '0',
        'italic': '0',
        'underline': '0',
        'strikeThrough': '0',
        'subscript': '0',
        'superscript': '0',
        'justifyleft': '0',
        'justifycenter': '0',
        'justifyright': '0',
        'justifyfull': '0',
        'InsertOrderedList': '0',
        'InsertUnorderedList': '0'
    },
        style;
    var range = _rangeUtilsRangeExtend2['default'].getRange(),
        zone = _tableUtilsTableZone2['default'].getZone(),
        cells,
        cellsAlign,
        rangeList = [];

    if (!range && (!zone.range || zone.active)) {
        return;
    }

    if (zone.grid && zone.range) {
        result.canCreateTable = '0';
    }

    if (range && (!zone.range || _tableUtilsTableZone2['default'].isSingleCell())) {
        result.blockFormat = _commonEnv2['default'].doc.queryCommandValue("formatBlock");
        result.fontName = _commonEnv2['default'].doc.queryCommandValue("fontName");
        result.foreColor = _commonUtils2['default'].rgb2Hex(_commonEnv2['default'].doc.queryCommandValue('foreColor'));
        result.backColor = _commonUtils2['default'].rgb2Hex(_commonEnv2['default'].doc.queryCommandValue('backColor'));
        result.bold = queryCommand('bold');
        result.italic = queryCommand('italic');
        result.underline = queryCommand('underline');
        result.strikeThrough = queryCommand('strikeThrough');
        result.subscript = queryCommand('subscript');
        result.superscript = queryCommand('superscript');
        result.justifyleft = queryCommand('justifyleft');
        result.justifycenter = queryCommand('justifycenter');
        result.justifyright = queryCommand('justifyright');
        result.justifyfull = queryCommand('justifyfull');
        result.InsertOrderedList = queryCommand('InsertOrderedList');
        result.InsertUnorderedList = queryCommand('InsertUnorderedList');

        style = {
            'font-size': ''
        };

        rangeList = _rangeUtilsRangeExtend2['default'].getRangeDomList({
            noSplit: true
        });
        if (rangeList) {
            rangeList = rangeList.list.length > 0 ? rangeList.list : [rangeList.startDom];
        }
    } else {
        cellsAlign = _tableUtilsTableUtils2['default'].getAlign(zone.grid, zone.range);
        cells = _tableUtilsTableZone2['default'].getSelectedCells();
        rangeList = _tableUtilsTableUtils2['default'].getDomsByCellList(cells);

        result.justifyleft = cellsAlign.align == 'left' ? '1' : '0';
        result.justifycenter = cellsAlign.align == 'center' ? '1' : '0';
        result.justifyright = cellsAlign.align == 'right' ? '1' : '0';

        style = {
            'font-size': '',
            'font-family': '',
            'font-weight': '',
            'font-style': '',
            'text-decoration': '',
            'color': '',
            'background-color': ''
        };
    }

    var i, j, k, v, o;
    for (i = 0, j = rangeList.length; i < j; i++) {
        o = rangeList[i];
        if (o.nodeType !== 3 && o.nodeType !== 1) {
            continue;
        }
        o = o.nodeType == 3 ? o.parentNode : rangeList[i];
        for (k in style) {
            if (style.hasOwnProperty(k)) {
                v = _domUtilsDomBase2['default'].getComputedStyle(o, k, true);
                if (!v) {
                    continue;
                }

                if (i === 0) {
                    style[k] = v;
                } else if (style[k] !== v) {
                    style[k] = '';
                }
            }
        }
    }

    var s = style['font-size'];
    if (s) {
        result['fontSize'] = s;
    }
    s = style['font-family'];
    if (s) {
        result['fontName'] = s;
    }
    s = style['font-weight'];
    if (s && /bold|bolder/.test(s)) {
        result['bold'] = '1';
    }
    s = style['font-style'];
    if (s && /italic|oblique/.test(s)) {
        result['italic'] = '1';
    }
    s = style['text-decoration'];
    if (s && /underline/.test(s)) {
        result['underline'] = '1';
    } else if (s && /line\-through/.test(s)) {
        result['strikeThrough'] = '1';
    }

    //默认的选中节点背景色 需要过滤掉
    if (result.backColor == '#f3f7ff') {
        result.backColor = '';
    }

    EditorEvent.triggerListener(EditorEventType.SelectionChange, [result]);

    function queryCommand(command) {
        return _commonEnv2['default'].doc.queryCommandState(command) ? "1" : "0";
    }
}

/**
 * 复制/剪切 选中区域
 * @param e
 * @param isCut
 */
function copySelection(e, isCut) {
    var zone = _tableUtilsTableZone2['default'].getZone(),
        range = _rangeUtilsRangeExtend2['default'].getRange(),
        fragment,
        oldHtml,
        newHtml,
        canSetData = true,
        user,
        style,
        domList = [];
    isCut = !!isCut;

    if (!zone.range && (!range || range.collapsed || !_amendAmend2['default'].isAmendEditing())) {
        return;
    }

    if (zone.range && (!range || range.collapsed)) {
        fragment = _tableUtilsTableZone2['default'].getFragmentForCopy(isCut);
    } else if (range && !range.collapsed) {
        fragment = _amendAmend2['default'].getFragmentForCopy(isCut);
    }
    if (fragment) {
        if (_amendAmend2['default'].isAmendEditing()) {
            oldHtml = fragment.innerHTML.length;
            _amendAmend2['default'].fragmentFilter(fragment);
            newHtml = fragment.innerHTML.length;
            if (newHtml === 0 && oldHtml > 0) {
                alert(_commonLang2['default'].Err.Copy_Null);
                canSetData = false;
            }
        }

        if (canSetData) {
            e.clipboardData.clearData();
            e.clipboardData.setData('text/plain', fragment.innerText);
            e.clipboardData.setData('text/html', fragment.innerHTML);

            if (isCut) {
                _commonHistoryUtils2['default'].saveSnap(false);
            }

            if (isCut && _amendAmend2['default'].isAmendEditing()) {
                user = _amendAmendUser2['default'].getCurUser();
                style = _amendAmendUtilsAmendExtend2['default'].getDeletedStyle(user);
                if (zone.range && (!range || range.collapsed)) {
                    //处理表格内部时，必须要把每一个叶子节点找出来，然后去处理
                    domList = _tableUtilsTableUtils2['default'].getDomsByCellList(_tableUtilsTableZone2['default'].getSelectedCells());

                    _rangeUtilsRangeExtend2['default'].modifyDomsStyle(domList, style.style, style.attr, []);
                    _amendAmendUtilsAmendExtend2['default'].removeUserDel(zone.table, user);
                } else {

                    _amendAmendUtilsAmendExtend2['default'].removeSelection(user);
                    _amendAmendUtilsAmendExtend2['default'].removeUserDel(null, user);
                    _commonEnv2['default'].doc.getSelection().collapseToEnd();
                    _rangeUtilsRangeExtend2['default'].caretFocus();
                }
            } else if (isCut && zone.range && (!range || range.collapsed)) {
                _tableUtilsTableCore2['default'].clearCellValue();
            }
        }

        fragment.innerHTML = '';
        fragment = null;
    }

    _commonUtils2['default'].stopEvent(e);
}
/**
 * 从剪切板粘贴内容
 * @param e
 */
function pasteFromClipBoard(e) {
    var fixed,
        template,
        html = e.clipboardData.getData('text/html'),
        txt = e.clipboardData.getData('text/plain'),
        range = _rangeUtilsRangeExtend2['default'].getRange(),
        zone = _tableUtilsTableZone2['default'].getZone(),
        target,
        insertBefore,
        gridPaste,
        pasteCell,
        pasteColCount,
        pasteRowCount,
        addColCount,
        addRowCount,
        maxCol,
        maxRow,
        x,
        y,
        cell;

    if (!range && !zone.table && !zone.range || !html && !txt) {
        return;
    }

    // console.log(html);
    // console.log(txt);

    _commonHistoryUtils2['default'].saveSnap(false);

    if (zone.table && zone.range) {
        // 在表格内粘贴

        if (html) {
            template = _tableUtilsTableUtils2['default'].getTemplateByHtmlForPaste(html);
        } else if (txt && !_tableUtilsTableZone2['default'].isSingleCell()) {
            template = _tableUtilsTableUtils2['default'].getTemplateByTxtForPaste(txt);
        } else {
            template = {
                isTable: false,
                pasteDom: _commonEnv2['default'].doc.createElement('div')
            };
            template.pasteDom.appendChild(_commonEnv2['default'].doc.createTextNode(txt));
        }
        // console.log(template.isTable);
        // console.log(template.pasteDom);

        if (!template.isTable) {
            // 粘贴普通文本

            if (!range && zone.range) {
                //如果选择了多个单元格，则只粘贴到左上角的单元格内
                target = zone.grid[zone.range.minY][zone.range.minX].cell;
                _tableUtilsTableZone2['default'].setStart(target).setEnd(target);
                _rangeUtilsRangeExtend2['default'].setRange(target, 0, target.lastChild, _domUtilsDomBase2['default'].getDomEndOffset(target.lastChild));
            }

            // 粘贴 非表格的 普通文本
            if (_amendAmend2['default'].isAmendEditing()) {
                //修订模式 预处理
                _amendAmend2['default'].readyForPaste();
            } else {
                //非修订模式 预处理
                fixed = _amendAmendUtilsAmendExtend2['default'].fixedAmendRange();
                _amendAmend2['default'].splitAmendDomByRange(fixed);
            }
            range = _rangeUtilsRangeExtend2['default'].getRange();
            if (range) {
                if (range.startContainer.nodeType === 3 && range.startOffset > 0 && range.startOffset < range.startContainer.nodeValue.length) {
                    //如果不符合预处理的条件，并且还处于 TextNode 中间时，需要拆分
                    target = _domUtilsDomBase2['default'].splitRangeText(range.startContainer, range.startOffset, range.startOffset);
                    insertBefore = false;
                } else {
                    target = range.startContainer;
                    if (target.nodeType === 3) {
                        insertBefore = range.startOffset === 0;
                    } else if (range.startOffset > 0 && !_domUtilsDomBase2['default'].isEmptyDom(target)) {
                        target = target.childNodes[range.startOffset - 1];
                        insertBefore = false;
                    } else {
                        insertBefore = true;
                    }

                    if (_domUtilsDomBase2['default'].isTag(target, ['td', 'th']) && _domUtilsDomBase2['default'].isEmptyDom(target)) {
                        //如果 target 是 td 则必须在 td内建立 span，避免插入到 td 后面
                        target.innerHTML = '';
                        target.appendChild(_domUtilsDomBase2['default'].createSpan());
                        target = target.childNodes[0];
                        insertBefore = false;
                    }
                }
                while (template.pasteDom.firstChild && target) {
                    _domUtilsDomBase2['default'].before(target, template.pasteDom.firstChild, !insertBefore);
                }

                // console.log(range.startContainer);
                // console.log(range.startOffset);
                // console.log(target);

                // range.startContainer.parentNode.removeChild(target);
            }
        } else {
                // 粘贴表格

                //分析剪切板内的表格范围
                gridPaste = _tableUtilsTableUtils2['default'].getTableGrid(template.pasteDom);
                pasteRowCount = gridPaste.length;
                pasteColCount = gridPaste[0] ? gridPaste[0].length : 0;

                //从起始点 cellData 根据 剪切板内表格范围 判断是否需要增加 表格的列、行
                addRowCount = zone.grid.length - zone.range.minY - pasteRowCount;
                addColCount = zone.grid[0].length - zone.range.minX - pasteColCount;

                for (y = addRowCount; y < 0; y++) {
                    _tableUtilsTableCore2['default'].insertRow(false);
                }
                for (x = addColCount; x < 0; x++) {
                    _tableUtilsTableCore2['default'].insertCol(false);
                }

                //分析已选择的表格范围
                zone = _tableUtilsTableZone2['default'].getZone();
                if (!html) {
                    //从文本转义的 table 只复制一次，不允许反复被粘贴
                    maxRow = zone.range.minY + pasteRowCount - 1;
                    maxCol = zone.range.minX + pasteColCount - 1;
                } else {
                    maxRow = Math.max(zone.range.minY + pasteRowCount - 1, zone.range.maxY);
                    maxCol = Math.max(zone.range.minX + pasteColCount - 1, zone.range.maxX);
                }

                //从起始点 cellData 开始 循环粘贴剪切板单元格
                _tableUtilsTableUtils2['default'].eachRange(zone.grid, {
                    minY: zone.range.minY,
                    maxY: maxRow,
                    minX: zone.range.minX,
                    maxX: maxCol
                }, function (cellData) {
                    if (!cellData.fake) {
                        cell = cellData.cell;
                        pasteCell = gridPaste[(cellData.y - zone.range.minY) % pasteRowCount][(cellData.x - zone.range.minX) % pasteColCount];

                        if (_amendAmend2['default'].isAmendEditing()) {
                            //修订模式 预处理
                            _rangeUtilsRangeExtend2['default'].setRange(cell, 0, cell.lastChild, _domUtilsDomBase2['default'].getDomEndOffset(cell.lastChild));
                            _amendAmendUtilsAmendExtend2['default'].removeSelection(_amendAmendUser2['default'].getCurUser());
                            _amendAmendUtilsAmendExtend2['default'].removeUserDel(cell, _amendAmendUser2['default'].getCurUser());

                            if (pasteCell.fake) {
                                return;
                            }

                            if (_domUtilsDomBase2['default'].isEmptyDom(cell)) {
                                cell.innerHTML = pasteCell.cell.innerHTML;
                            } else {
                                while (pasteCell.cell.firstChild) {
                                    cell.appendChild(pasteCell.cell.firstChild);
                                }
                            }

                            _amendAmend2['default'].fixPaste(cell.firstChild, cell.lastChild, _amendAmendUser2['default'].getCurUser());
                        } else {
                            cell.innerHTML = pasteCell.fake ? '' : pasteCell.cell.innerHTML;
                        }
                    }
                });
                //粘贴后，需要修订 range
                _tableUtilsTableZone2['default'].setStart(zone.grid[zone.range.minY][zone.range.minX].cell).setEnd(zone.grid[maxRow][maxCol].cell);
            }

        _commonUtils2['default'].stopEvent(e);
    } else if (_amendAmend2['default'].isAmendEditing()) {
        //修订模式下， 表格外 粘贴
        _amendAmend2['default'].readyForPaste();
    } else {
        //非修订模式下， 表格外 粘贴
        fixed = _amendAmendUtilsAmendExtend2['default'].fixedAmendRange();
        _amendAmend2['default'].splitAmendDomByRange(fixed);
    }
}
/**
 * 专门针对 IOS 的粘贴 操作 补丁
 * @param e
 * @returns {boolean}
 */
function pasteForIOS(e) {
    _commonUtils2['default'].stopEvent(e);
    var sel = _commonEnv2['default'].doc.getSelection();

    //必须让 光标 消失然后再重新设置， 否则会导致 IOS 上一直显示 粘贴的 tooltip
    _rangeUtilsRangeExtend2['default'].backupCaret();
    sel.removeAllRanges();
    setTimeout(function () {
        _rangeUtilsRangeExtend2['default'].restoreCaret();
        _commonEnv2['default'].client.sendCmdToWiznote(_commonConst2['default'].CLIENT_EVENT.WizEditorPaste, '');
    }, 0);
}

function eventStringify(event) {
    var k,
        v,
        t,
        s = [];
    for (k in event) {
        v = event[k];
        t = (typeof v).toLowerCase();
        if (t == 'string' || t == 'number') {
            if (t == 'string') {
                v = '"' + v.replace(/"/g, '\\"') + '"';
            }
            s.push('"' + k + '":' + v);
        }
    }
    return '{' + s.join(',') + '}';
}

var EditorEvent = {
    TYPE: EditorEventType,
    bind: function bind() {
        EditorEvent.unbind();
        _commonEnv2['default'].doc.addEventListener('click', handler.onClick);
        _commonEnv2['default'].doc.addEventListener('compositionstart', handler.onCompositionstart);
        _commonEnv2['default'].doc.addEventListener('compositionend', handler.onCompositionend);
        _commonEnv2['default'].doc.addEventListener('copy', handler.onCopy);
        _commonEnv2['default'].doc.addEventListener('cut', handler.onCut);
        _commonEnv2['default'].doc.addEventListener('dragstart', handler.onDragStart);
        _commonEnv2['default'].doc.addEventListener('dragenter', handler.onDragEnter);
        _commonEnv2['default'].doc.addEventListener('drop', handler.onDrop);
        _commonEnv2['default'].doc.addEventListener('keydown', handler.onKeydown);
        _commonEnv2['default'].doc.addEventListener('keyup', handler.onKeyup);
        _commonEnv2['default'].doc.addEventListener('mousedown', handler.onMousedown);
        _commonEnv2['default'].doc.addEventListener('mousemove', handler.onMousemove);
        _commonEnv2['default'].doc.addEventListener('mouseover', handler.onMouseover);
        _commonEnv2['default'].doc.addEventListener('mouseup', handler.onMouseup);
        _commonEnv2['default'].doc.addEventListener('paste', handler.onPaste);
        _commonEnv2['default'].doc.addEventListener('scroll', handler.onScroll);
        _commonEnv2['default'].doc.addEventListener('selectstart', handler.onSelectionStart);
        _commonEnv2['default'].doc.addEventListener('selectionchange', handler.onSelectionChange);

        if (_commonEnv2['default'].client.type.isIOS || _commonEnv2['default'].client.type.isAndroid) {
            _commonEnv2['default'].doc.addEventListener('touchend', handler.onTouchEnd);
            _commonEnv2['default'].doc.addEventListener('touchstart', handler.onTouchStart);
        }
    },
    unbind: function unbind() {
        _commonEnv2['default'].doc.removeEventListener('click', handler.onClick);
        _commonEnv2['default'].doc.removeEventListener('compositionstart', handler.onCompositionstart);
        _commonEnv2['default'].doc.removeEventListener('compositionend', handler.onCompositionend);
        _commonEnv2['default'].doc.removeEventListener('copy', handler.onCopy);
        _commonEnv2['default'].doc.removeEventListener('cut', handler.onCut);
        _commonEnv2['default'].doc.removeEventListener('dragstart', handler.onDragStart);
        _commonEnv2['default'].doc.removeEventListener('dragenter', handler.onDragEnter);
        _commonEnv2['default'].doc.removeEventListener('drop', handler.onDrop);
        _commonEnv2['default'].doc.removeEventListener('keydown', handler.onKeydown);
        _commonEnv2['default'].doc.removeEventListener('keyup', handler.onKeyup);
        _commonEnv2['default'].doc.removeEventListener('mousedown', handler.onMousedown);
        _commonEnv2['default'].doc.removeEventListener('mousemove', handler.onMousemove);
        _commonEnv2['default'].doc.removeEventListener('mouseover', handler.onMouseover);
        _commonEnv2['default'].doc.removeEventListener('mouseup', handler.onMouseup);
        _commonEnv2['default'].doc.removeEventListener('paste', handler.onPaste);
        _commonEnv2['default'].doc.removeEventListener('scroll', handler.onScroll);
        _commonEnv2['default'].doc.removeEventListener('selectstart', handler.onSelectionStart);
        _commonEnv2['default'].doc.removeEventListener('selectionchange', handler.onSelectionChange);
        _commonEnv2['default'].doc.removeEventListener('touchend', handler.onTouchEnd);
        _commonEnv2['default'].doc.removeEventListener('touchstart', handler.onTouchStart);
    },
    startTrackEvent: function startTrackEvent(eventName, id) {
        if (!eventTrackHandler[id]) {
            eventTrackHandler[id] = function (event) {
                _commonEnv2['default'].client.sendCmdToWiznote(_commonConst2['default'].CLIENT_EVENT.wizEditorTrackEvent, {
                    id: id,
                    event: eventStringify(event)
                });
            };
            _commonEnv2['default'].doc.addEventListener(eventName, eventTrackHandler[id]);
        }
    },
    stopTrackEvent: function stopTrackEvent(eventName, id) {
        if (eventTrackHandler[id]) {
            _commonEnv2['default'].doc.removeEventListener(eventName, eventTrackHandler[id]);
            delete eventTrackHandler[id];
        }
    },
    addListener: function addListener(eName, fun) {
        if (!fun || typeof fun !== 'function') {
            return;
        }
        var h = editorListener[eName];
        if (!h) {
            return;
        }
        var i, j;
        for (i = 0, j = h.length; i < j; i++) {
            if (h[i] === fun) {
                return;
            }
        }
        h.push(fun);
        if (eName == EditorEventType.SelectionChange) {
            _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_SELECT_CHANGE, getCaretStyle);
        }
    },
    removeListener: function removeListener(eName, fun) {
        if (fun && typeof fun !== 'function') {
            return;
        }
        var h = editorListener[eName];
        if (!h) {
            return;
        }
        var i;
        for (i = h.length - 1; i >= 0; i--) {
            if (h[i] === fun || !fun) {
                h.splice(i, 1);
            }
        }

        if (h.length === 0) {
            _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_SELECT_CHANGE, getCaretStyle);
        }
    },
    triggerListener: function triggerListener(eName, params) {
        var h = editorListener[eName];
        if (!h) {
            return;
        }
        var i, j, f;
        for (i = 0, j = h.length; i < j; i++) {
            f = h[i];
            f.apply(this, params);
        }
    }
};

var handler = {
    onClick: function onClick(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_CLICK, e);
    },
    onCompositionstart: function onCompositionstart(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_COMPOSITION_START, e);
    },
    onCompositionend: function onCompositionend(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_COMPOSITION_END, e);
    },
    onCopy: function onCopy(e) {
        copySelection(e, false);
        // ENV.event.call(CONST.EVENT.ON_COPY, e);
    },
    onCut: function onCut(e) {
        copySelection(e, true);

        // ENV.event.call(CONST.EVENT.ON_COPY, e);
    },
    onDragStart: function onDragStart(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_DRAG_START, e);
    },
    onDragEnter: function onDragEnter(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_DRAG_ENTER, e);
    },
    onDrop: function onDrop(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_DROP, e);
    },
    onKeydown: function onKeydown(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_KEY_DOWN, e);
    },
    onKeyup: function onKeyup(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_KEY_UP, e);
    },
    onMousedown: function onMousedown(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_MOUSE_DOWN, e);
    },
    onMousemove: function onMousemove(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_MOUSE_MOVE, e);
    },
    onMouseover: function onMouseover(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_MOUSE_OVER, e);
    },
    onMouseup: function onMouseup(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_MOUSE_UP, e);
    },
    onPaste: function onPaste(e) {
        if (_commonEnv2['default'].client.type.isIOS) {
            pasteForIOS(e);
            return;
        }
        pasteFromClipBoard(e);

        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_PASTE, e);
    },
    onScroll: function onScroll(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_SCROLL, e);
    },
    onSelectionStart: function onSelectionStart(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_SELECT_START, e);
    },
    onSelectionChange: function onSelectionChange(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_SELECT_CHANGE, e);
    },
    onTouchEnd: function onTouchEnd(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_TOUCH_END, e);
    },
    onTouchStart: function onTouchStart(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_TOUCH_START, e);
    }
};

exports['default'] = EditorEvent;
module.exports = exports['default'];

},{"../amend/amend":7,"../amend/amendUser":9,"../amend/amendUtils/amendExtend":11,"../common/const":13,"../common/env":15,"../common/historyUtils":16,"../common/lang":17,"../common/utils":19,"../domUtils/domBase":23,"../rangeUtils/rangeExtend":36,"../tableUtils/tableCore":39,"../tableUtils/tableUtils":41,"../tableUtils/tableZone":42}],27:[function(require,module,exports){
/**
 * tab 键操作处理
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _domUtilsDomExtend = require('../domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

var _rangeUtilsRangeExtend = require('../rangeUtils/rangeExtend');

var _rangeUtilsRangeExtend2 = _interopRequireDefault(_rangeUtilsRangeExtend);

var _commonHistoryUtils = require('../common/historyUtils');

var _commonHistoryUtils2 = _interopRequireDefault(_commonHistoryUtils);

var tabHtml = ' &nbsp; &nbsp;';

function processTab(prev) {
    var range = _rangeUtilsRangeExtend2['default'].getRange();
    if (!range) {
        return;
    }

    if (prev) {
        _commonHistoryUtils2['default'].saveSnap(false);
        document.execCommand("outdent");
        return true;
    }

    var dom = range.startContainer,
        startOffset = range.startOffset,
        isListDom = _domUtilsDomExtend2['default'].isTag(dom, ['ul', 'ol', 'li']),
        parent = _domUtilsDomExtend2['default'].getParentByTagName(dom, ['ul', 'ol', 'li'], false),
        isListStart = startOffset === 0 && _domUtilsDomExtend2['default'].getFirstDeepChild(parent) === dom;

    var tagName = dom.tagName;

    if (tagName == "TD") {
        return false;
    } else if (!range.collapsed || isListStart || isListDom) {
        _commonHistoryUtils2['default'].saveSnap(false);
        document.execCommand("indent");
        return true;
    } else if (dom.nodeType === 3 || _domUtilsDomExtend2['default'].getParentByTagName(dom, ['a', 'b', 'body', 'div', 'font', 'html', 'i', 'p', 'span', 'strong', 'u'])) {
        _commonHistoryUtils2['default'].saveSnap(false);
        document.execCommand("insertHTML", false, tabHtml);
        return true;
    }
    //
    return false;
}

var _event = {
    bind: function bind() {
        _event.unbind();
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_KEY_DOWN, _event.handler.onKeyDown);
    },
    unbind: function unbind() {
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_KEY_DOWN, _event.handler.onKeyDown);
    },
    handler: {
        onKeyDown: function onKeyDown(e) {
            var keyCode = e.keyCode || e.which;
            if (keyCode !== 9) {
                return;
            }

            if (processTab(e.shiftKey)) {
                _commonUtils2['default'].stopEvent(e);
            }
        }
    }
};

var tabKey = {
    init: function init(html) {
        tabHtml = html;
    },
    on: function on() {
        _event.bind();
    },
    off: function off() {
        _event.unbind();
    }
};

exports['default'] = tabKey;
module.exports = exports['default'];

},{"../common/const":13,"../common/env":15,"../common/historyUtils":16,"../common/utils":19,"../domUtils/domExtend":24,"../rangeUtils/rangeExtend":36}],28:[function(require,module,exports){
/**
 * img 操作基本方法集合
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('./../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('./../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('./../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _domUtilsDomExtend = require('./../domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

var _rangeUtilsRangeExtend = require('./../rangeUtils/rangeExtend');

var _rangeUtilsRangeExtend2 = _interopRequireDefault(_rangeUtilsRangeExtend);

var handleSuffix = ['lt', 'tm', 'rt', 'rm', 'rb', 'bm', 'lb', 'lm'];

var resizingHanlde = '';
var WIZ_STYLE = 'wiz_style';

var startOffsetX;
var startOffsetY;
var lastMousex;
var lastMousey;
var oppCornerX;
var oppCornerY;

var cursorOri;
var cursor;

function init() {
    cursorOri = _commonEnv2['default'].doc.body.style.cursor || '';

    // TODO 临时为 pc端处理，pc端整合后， 直接删除
    _commonEnv2['default'].win.WizImgResizeOnGetHTML = function () {};
}

function initImageDragResize(img) {
    if (!img || !img.tagName || img.tagName.toLowerCase() != 'img') return;
    if (!canDragResize(img)) return;
    //
    var container = createHandles();
    if (!container) {
        return;
    }
    resetHandlesSize(img);
    initImage(img);

    _event.bindContainer(container);
}

function clearHandles() {
    removeImgAttributes();
    removeHandles();
    _commonEnv2['default'].doc.body.style.cursor = cursorOri;
}

function createHandles() {
    var container = getHandleContainer();
    if (container) {
        return container;
    }
    container = _commonEnv2['default'].doc.createElement(_commonConst2['default'].TAG.TMP_TAG);
    _domUtilsDomExtend2['default'].addClass(container, _commonConst2['default'].CLASS.IMG_RESIZE_CONTAINER);
    container.setAttribute('contenteditable', 'false');
    container.setAttribute(WIZ_STYLE, 'unsave');

    for (var i = 0; i < handleSuffix.length; i++) {
        var handle = _commonEnv2['default'].doc.createElement('div');
        _domUtilsDomExtend2['default'].addClass(handle, _commonConst2['default'].CLASS.IMG_RESIZE_HANDLE);
        _domUtilsDomExtend2['default'].addClass(handle, handleSuffix[i]);
        _domUtilsDomExtend2['default'].attr(handle, {
            'data-type': handleSuffix[i]
        });
        container.appendChild(handle);
    }
    _commonEnv2['default'].doc.body.appendChild(container);
    return container;
}

function getHandleContainer() {
    var container = _commonEnv2['default'].doc.body.querySelector('.' + _commonConst2['default'].CLASS.IMG_RESIZE_CONTAINER);
    if (!container || container.length < 1) {
        return null;
    }
    return container;
}

function setHandleSize(imgOptions, handle) {
    if (!imgOptions || !handle) return;
    var offset = imgOptions.offset;
    var x = offset.left,
        y = offset.top,
        width = imgOptions.width,
        height = imgOptions.height;

    var handleName = handle.getAttribute('data-type');
    var left = 0,
        top = 0;
    switch (handleName) {
        case 'lt':
            left = x - 7;
            top = y - 7;
            break;
        case 'tm':
            left = x + (width - 7) / 2;
            top = y - 7;
            break;
        case 'rt':
            left = x + width;
            top = y - 7;
            break;
        case 'rm':
            left = x + width;
            top = y + (height - 7) / 2;
            break;
        case 'rb':
            left = x + width;
            top = y + height;
            break;
        case 'bm':
            left = x + (width - 7) / 2;
            top = y + height;
            break;
        case 'lb':
            left = x - 7;
            top = y + height;
            break;
        case 'lm':
            left = x - 7;
            top = y + (height - 7) / 2;
            break;
    }
    _domUtilsDomExtend2['default'].css(handle, {
        left: left + 'px',
        top: top + 'px'
    });
}

function resetHandlesSize(img) {
    if (!img) {
        return;
    }
    var container = getHandleContainer();
    if (!container) {
        return;
    }
    var handles = container.querySelectorAll('.' + _commonConst2['default'].CLASS.IMG_RESIZE_HANDLE);

    var imgOptions = {
        offset: _domUtilsDomExtend2['default'].getOffset(img),
        width: img.width,
        height: img.height
    };
    for (var i = 0; i < handles.length; i++) {
        var handle = handles[i];
        setHandleSize(imgOptions, handle);
        handle.style.visibility = 'inherit';
    }
}

function removeImgAttributes() {
    var imgList = _commonEnv2['default'].doc.querySelectorAll('.' + _commonConst2['default'].CLASS.IMG_RESIZE_ACTIVE);
    if (!imgList || imgList.length === 0) {
        return;
    }
    var i;
    for (i = imgList.length - 1; i >= 0; i--) {
        _domUtilsDomExtend2['default'].removeClass(imgList[i], _commonConst2['default'].CLASS.IMG_RESIZE_ACTIVE);
    }
}

function removeHandles() {
    var container = getHandleContainer();
    if (!container) {
        return;
    }
    _event.unbindContainer(container);
    container.parentNode.removeChild(container);
}

function initImage(img) {
    if (!img) {
        return;
    }
    removeImgAttributes();
    _domUtilsDomExtend2['default'].addClass(img, _commonConst2['default'].CLASS.IMG_RESIZE_ACTIVE);
    img.attributes[_commonConst2['default'].ATTR.IMG_RATE] = img.width / img.height;
}

function canDragResize(img) {
    if (!img) return false;
    //
    var className = img.getAttribute('class');
    if (className && -1 != className.indexOf(_commonConst2['default'].CLASS.IMG_NOT_DRAG)) return false;
    //
    return true;
}

function showHandles(show) {
    var container = getHandleContainer();
    if (!container) {
        return;
    }
    container.style.display = show ? 'block' : 'none';

    if (!show) {
        clearHandles();
    }
}
function scaleImgSize(rate, widthDraged, heightDraged, img) {
    if (!img) return;
    //
    var widthSized = heightDraged * rate;
    var heightSized = widthDraged / rate;
    //
    if (widthSized < widthDraged) widthSized = widthDraged;else heightSized = heightDraged;
    //
    img.width = widthSized;
    img.height = heightSized;
}

var _event = {
    bind: function bind() {
        _event.unbind();
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.BEFORE_GET_DOCHTML, _event.handler.beforeGetDocHtml);
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_KEY_DOWN, _event.handler.onKeyDown);
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_MOUSE_DOWN, _event.handler.onMouseDown);
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_MOUSE_MOVE, _event.handler.onMouseMove);
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_MOUSE_UP, _event.handler.onMouseUp);
    },
    bindContainer: function bindContainer(container) {
        _event.unbindContainer(container);
        container.addEventListener('mousedown', _event.handler.onContainerMouseDown);
    },
    unbind: function unbind() {
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_KEY_DOWN, _event.handler.onKeyDown);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_MOUSE_DOWN, _event.handler.onMouseDown);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_MOUSE_MOVE, _event.handler.onMouseMove);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_MOUSE_UP, _event.handler.onMouseUp);
    },
    unbindContainer: function unbindContainer(container) {
        container.removeEventListener('mousedown', _event.handler.onContainerMouseDown);
    },
    handler: {
        beforeGetDocHtml: function beforeGetDocHtml() {
            clearHandles();
        },
        onKeyDown: function onKeyDown() {
            showHandles(false);
        },
        onContainerMouseDown: function onContainerMouseDown(e) {
            var elm = e.target || e.srcElement;
            resizingHanlde = elm.getAttribute('data-type');
            var img = _commonEnv2['default'].doc.querySelector('.' + _commonConst2['default'].CLASS.IMG_RESIZE_ACTIVE);
            var mousex, mousey, offset;
            if (!img) {
                return;
            }

            mousex = e.pageX;
            mousey = e.pageY;
            offset = _domUtilsDomExtend2['default'].getOffset(img);
            //
            switch (resizingHanlde) {
                case 'lt':
                    startOffsetX = offset.left - mousex;
                    startOffsetY = offset.top - mousey;
                    //
                    oppCornerX = offset.left + img.width;
                    oppCornerY = offset.top + img.height;
                    //
                    cursor = 'nw-resize';
                    break;
                case 'tm':
                    startOffsetX = undefined;
                    startOffsetY = offset.top - mousey;
                    //
                    cursor = 'n-resize';

                    break;
                case 'rt':
                    startOffsetX = mousex - img.width - offset.left;
                    startOffsetY = offset.top - mousey;
                    //
                    oppCornerX = offset.left;
                    oppCornerY = offset.top + img.height;
                    //
                    cursor = 'ne-resize';
                    break;
                case 'rm':
                    startOffsetX = mousex - img.width - offset.left;
                    startOffsetY = undefined;
                    //
                    cursor = 'e-resize';
                    break;
                case 'rb':
                    startOffsetX = mousex - img.width - offset.left;
                    startOffsetY = mousey - img.height - offset.top;
                    //
                    cursor = 'se-resize';
                    break;
                case 'bm':
                    startOffsetX = undefined;
                    startOffsetY = mousey - img.height - offset.top;
                    //
                    oppCornerX = offset.left / 2;
                    oppCornerY = offset.top;
                    //
                    cursor = 's-resize';
                    break;
                case 'lb':
                    startOffsetX = offset.left - mousex;
                    startOffsetY = mousey - img.height - offset.top;
                    //
                    oppCornerX = offset.left + img.width;
                    oppCornerY = offset.top;
                    //
                    cursor = 'sw-resize';
                    break;
                case 'lm':
                    startOffsetX = offset.left - mousex;
                    startOffsetY = undefined;
                    //
                    cursor = 'w-resize';
                    break;
            }
            _commonUtils2['default'].stopEvent(e);
        },
        onMouseDown: function onMouseDown() {
            showHandles(false);
            removeImgAttributes();
        },
        onMouseMove: function onMouseMove(e) {
            var img = _commonEnv2['default'].doc.querySelector('.' + _commonConst2['default'].CLASS.IMG_RESIZE_ACTIVE);
            var offset, mousex, mousey;
            if (!img) {
                return;
            }
            offset = _domUtilsDomExtend2['default'].getOffset(img);
            //
            if (resizingHanlde) {
                //
                mousex = e.pageX;
                mousey = e.pageY;
                //
                _commonEnv2['default'].doc.body.style.cursor = cursor;
                // console.log('mousex: ' + mousex + ', mousey: ' + mousey);
                // console.log('lastMousex: ' + lastMousex + ', lastMousey: ' + lastMousey);
                var rate;
                var widthDraged;
                var heightDraged;
                var widthSized;
                var heightSized;
                //
                if (!lastMousex || !lastMousey) {
                    lastMousex = mousex;
                    lastMousey = mousey;
                }
                //
                switch (resizingHanlde) {
                    case 'tm':
                        img.width = img.width;
                        if (mousey < offset.top) {
                            img.height += lastMousey - mousey;
                        } else {
                            heightSized = img.height - (mousey - lastMousey) - startOffsetY;
                            img.height = heightSized < 0 ? 0 : heightSized;
                        }
                        break;
                    case 'rm':
                        widthSized = mousex - offset.left - startOffsetX;
                        img.width = widthSized < 0 ? 0 : widthSized;
                        img.height = img.height;
                        img.attributes[_commonConst2['default'].ATTR.IMG_RATE] = img.width / img.height;
                        break;
                    case 'bm':
                        img.width = img.width;
                        heightSized = mousey - oppCornerY - startOffsetY;
                        img.height = heightSized < 0 ? 0 : heightSized;
                        img.attributes[_commonConst2['default'].ATTR.IMG_RATE] = img.width / img.height;
                        break;
                    case 'lm':
                        img.height = img.height;
                        if (mousex < offset.left) {
                            img.width += lastMousex - mousex;
                        } else {
                            widthSized = img.width - (mousex - lastMousex) - startOffsetX;
                            img.width = widthSized < 0 ? 0 : widthSized;
                        }
                        break;
                    case 'lt':
                        rate = Number(img.attributes[_commonConst2['default'].ATTR.IMG_RATE]);
                        //
                        widthDraged = oppCornerX - mousex;
                        heightDraged = oppCornerY - mousey;
                        //
                        widthDraged -= startOffsetX;
                        heightDraged -= startOffsetY;
                        //
                        widthDraged = widthDraged < 0 ? 0 : widthDraged;
                        heightDraged = heightDraged < 0 ? 0 : heightDraged;
                        //
                        scaleImgSize(rate, widthDraged, heightDraged, img);
                        break;
                    case 'rt':
                        rate = Number(img.attributes[_commonConst2['default'].ATTR.IMG_RATE]);
                        //
                        widthDraged = mousex - oppCornerX;
                        heightDraged = oppCornerY - mousey;
                        //
                        widthDraged -= startOffsetX;
                        heightDraged -= startOffsetY;
                        //
                        widthDraged = widthDraged < 0 ? 0 : widthDraged;
                        heightDraged = heightDraged < 0 ? 0 : heightDraged;
                        //
                        scaleImgSize(rate, widthDraged, heightDraged, img);
                        break;
                    case 'lb':
                        rate = Number(img.attributes[_commonConst2['default'].ATTR.IMG_RATE]);
                        //
                        widthDraged = oppCornerX - mousex;
                        heightDraged = mousey - oppCornerY;
                        //
                        widthDraged -= startOffsetX;
                        heightDraged -= startOffsetY;
                        //
                        widthDraged = widthDraged < 0 ? 0 : widthDraged;
                        heightDraged = heightDraged < 0 ? 0 : heightDraged;
                        //
                        scaleImgSize(rate, widthDraged, heightDraged, img);
                        break;
                    case 'rb':
                        rate = Number(img.attributes[_commonConst2['default'].ATTR.IMG_RATE]);
                        // console.log('mousex: ' + mousex + 'mousey: ' + mousey);
                        widthDraged = mousex - offset.left;
                        heightDraged = mousey - offset.top;
                        //
                        widthDraged -= startOffsetX;
                        heightDraged -= startOffsetY;
                        //
                        widthDraged = widthDraged < 0 ? 0 : widthDraged;
                        heightDraged = heightDraged < 0 ? 0 : heightDraged;
                        //
                        scaleImgSize(rate, widthDraged, heightDraged, img);
                        //
                        // console.log('rate: ' + rate + ', ' + 'widthDraged: ' + widthDraged + ', ' + 'heightDraged: ' + heightDraged + ', ' + 'widthSized: ' +
                        // 	widthSized + ', ' + 'heightSized: ' + heightSized);
                        break;
                }
                //
                if (img.style.cssText) {
                    var cssText = img.style.cssText;
                    cssText = cssText.replace(/width:\s*\d+.?\d+px;?/ig, 'width: ' + img.width + 'px').replace(/height:\s*\d+.?\d+px;?/ig, 'height: ' + img.height + 'px');
                    //
                    img.style.cssText = cssText;
                }
                //
                lastMousex = mousex;
                lastMousey = mousey;

                resetHandlesSize(img);
                _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.UPDATE_RENDER, null);
                //
                // TODO pc统一使用 editor 的 修改判断后可删除此逻辑
                if (_commonEnv2['default'].win.WizChromeBrowser) {
                    _commonEnv2['default'].win.WizChromeBrowser.OnDomModified();
                }
            }
        },
        onMouseUp: function onMouseUp(e) {
            var elm = e.target || e.srcElement;
            if (elm && elm.tagName && elm.tagName.toLowerCase() == 'img') {
                initImageDragResize(elm);
                //
            }
            //
            resizingHanlde = '';
            //
            lastMousex = undefined;
            lastMousey = undefined;
            //
            oppCornerX = undefined;
            oppCornerY = undefined;
            //
            startOffsetX = undefined;
            startOffsetY = undefined;
            //
            _commonEnv2['default'].doc.body.style.cursor = cursorOri;
        }
    }
};

var imgResize = {
    init: init,
    bind: _event.bind,
    unbind: _event.unbind
};

exports['default'] = imgResize;
module.exports = exports['default'];

},{"./../common/const":13,"./../common/env":15,"./../common/utils":19,"./../domUtils/domExtend":24,"./../rangeUtils/rangeExtend":36}],29:[function(require,module,exports){
/**
 * img 操作基本方法集合
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('./../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('./../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('./../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _domUtilsDomExtend = require('./../domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

var _rangeUtilsRangeExtend = require('./../rangeUtils/rangeExtend');

var _rangeUtilsRangeExtend2 = _interopRequireDefault(_rangeUtilsRangeExtend);

var _imgResize = require('./imgResize');

var _imgResize2 = _interopRequireDefault(_imgResize);

var imgUtils = {
    on: function on() {
        _imgResize2['default'].init();
        _imgResize2['default'].bind();
    },
    off: function off() {
        _imgResize2['default'].unbind();
    },
    getAll: function getAll(onlyLocal) {
        var images = _commonEnv2['default'].doc.images,
            img,
            imageSrcs = [],
            tmp = {},
            src;
        for (img in images) {
            if (images.hasOwnProperty(img)) {
                //有特殊字符的文件名， 得到src 时是被转义后的名字，所以必须 decode 处理
                src = decodeURIComponent(images[img].src);
                if (imgFilter(images[img], onlyLocal) && !tmp[src]) {
                    imageSrcs.push(src);
                    tmp[src] = true;
                }
            }
        }
        return imageSrcs;
    },
    getImageSize: function getImageSize(imgSrc) {
        var newImg = new Image();
        newImg.src = imgSrc;
        var height = newImg.height;
        var width = newImg.width;
        return { width: width, height: height };
    },
    getImageData: function getImageData(img) {
        var size = imgUtils.getImageSize(img.src);
        // Create an empty canvas element
        var canvas = _commonEnv2['default'].doc.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;

        // Copy the image contents to the canvas
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);

        // Get the data-URL formatted image
        // Firefox supports PNG and JPEG. You could check img.src to
        // guess the original format, but be aware the using "image/jpg"
        // will re-encode the image.
        var dataURL = canvas.toDataURL("image/png");

        return dataURL.replace(/^data:image\/(png|jpg);base64,/, "");
    },
    makeAttachmentHtml: function makeAttachmentHtml(guid, imgPath) {
        return '<div style="margin: 15px auto;"><a href="wiz:open_attachment?guid=' + guid + '"><img src="' + imgPath + '" style="width: 280px; height:auto;"></a></div><div><br/></div>';
    },
    makeDomByPath: function makeDomByPath(imgPath) {
        var result = [],
            paths = [],
            main,
            img,
            i,
            j;
        if (imgPath.indexOf('*')) {
            paths = imgPath.split("*");
        } else {
            paths.push(imgPath);
        }

        for (i = 0, j = paths.length; i < j; i++) {
            main = _commonEnv2['default'].doc.createElement("div");
            result.push(main);

            img = _commonEnv2['default'].doc.createElement("img");
            img.src = paths[i];
            img.style.maxWidth = '100%';
            main.insertBefore(img, null);
        }

        main = _commonEnv2['default'].doc.createElement("div");
        main.insertBefore(_commonEnv2['default'].doc.createElement("br"), null);
        result.push(main);
        return result;
    }
};

function imgFilter(img, onlyLocal) {
    if (!img || img.className && img.className.indexOf('wiz-todo') > -1) {
        //checklist 的图片不进行获取
        return false;
    }
    var path = img.src;
    if (!path) {
        return false;
    }
    var rLocal = /^(http|https|ftp):/,
        rNoBase64 = /^(data):/,
        result;

    result = !rNoBase64.test(path);
    if (!result || !onlyLocal) {
        return result;
    }
    return !rLocal.test(path);
}

exports['default'] = imgUtils;
module.exports = exports['default'];

},{"./../common/const":13,"./../common/env":15,"./../common/utils":19,"./../domUtils/domExtend":24,"./../rangeUtils/rangeExtend":36,"./imgResize":28}],30:[function(require,module,exports){
/**
 * 超链接操作基本方法集合
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('./../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('./../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('./../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _domUtilsDomExtend = require('./../domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

var _rangeUtilsRangeExtend = require('./../rangeUtils/rangeExtend');

var _rangeUtilsRangeExtend2 = _interopRequireDefault(_rangeUtilsRangeExtend);

var _event = {
    bind: function bind() {
        _event.unbind();
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_KEY_DOWN, _event.handler.onKeyDown);
    },
    unbind: function unbind() {
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_KEY_DOWN, _event.handler.onKeyDown);
    },
    handler: {
        onKeyDown: function onKeyDown(e) {
            var keyCode = e.keyCode || e.which;
            var start, next;
            var sel, range, offset, charCode;
            if (keyCode == 32 || keyCode == 13) {
                sel = _commonEnv2['default'].doc.getSelection();
                range = sel.getRangeAt(0).cloneRange();

                start = range.startContainer;
                while (start.nodeType == 1 && range.startOffset > 0) {
                    start = range.startContainer.childNodes[range.startOffset - 1];
                    if (!start) {
                        break;
                    }
                    range.setStart(start, _domUtilsDomExtend2['default'].getDomEndOffset(start));
                    range.collapse(true);
                    start = range.startContainer;
                }
                do {
                    if (range.startOffset === 0) {
                        start = range.startContainer.previousSibling;

                        while (start && start.nodeType == 1) {
                            start = start.lastChild;
                        }
                        if (!start || _domUtilsDomExtend2['default'].isFillChar(start, false)) {
                            break;
                        }
                        offset = start.nodeValue.length;
                    } else {
                        start = range.startContainer;
                        offset = range.startOffset;
                    }
                    range.setStart(start, offset - 1);
                    charCode = range.toString().charCodeAt(0);
                } while (charCode != 160 && charCode != 32);

                if (range.toString().replace(_commonConst2['default'].FILL_CHAR_REG, '').match(/(?:https?:\/\/|ssh:\/\/|ftp:\/\/|file:\/|www\.)/i)) {
                    while (range.toString().length) {
                        if (/^(?:https?:\/\/|ssh:\/\/|ftp:\/\/|file:\/|www\.)/i.test(range.toString())) {
                            break;
                        }
                        try {
                            range.setStart(range.startContainer, range.startOffset + 1);
                        } catch (e) {
                            //trace:2121
                            start = range.startContainer;
                            while (!(next = start.nextSibling)) {
                                if (_domUtilsDomExtend2['default'].isBody(start)) {
                                    return;
                                }
                                start = start.parentNode;
                            }
                            range.setStart(next, 0);
                        }
                    }
                    //if is <a>, then return;
                    if (_domUtilsDomExtend2['default'].getParentByTagName(range.startContainer, 'a', true, null)) {
                        return;
                    }
                    var a = _commonEnv2['default'].doc.createElement('a'),
                        text = _commonEnv2['default'].doc.createTextNode(' '),
                        href;

                    var rangeText = range.extractContents();
                    a.innerHTML = a.href = rangeText.textContent.replace(/<[^>]+>/g, '');
                    href = a.getAttribute("href").replace(_commonConst2['default'].FILL_CHAR_REG, '');
                    href = /^(?:https?:\/\/)/ig.test(href) ? href : "http://" + href;
                    //                    a.setAttribute('_src', href);
                    a.href = href;

                    range.insertNode(a);
                    a.parentNode.insertBefore(text, a.nextSibling);
                    range.setStart(text, 0);
                    range.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            }
        }
    }
};
/**
 * 根据输入内容 自动匹配并生成 超链接 <a>
 */
var linkUtils = {
    on: function on() {
        _event.bind();
    },
    off: function off() {
        _event.unbind();
    },
    /**
     * 移除选中的 <a> 标签的超链接
     */
    removeSelectedLink: function removeSelectedLink() {
        var sel = _commonEnv2['default'].doc.getSelection();
        var currentNode = sel.focusNode;
        while (currentNode && !_domUtilsDomExtend2['default'].isTag(currentNode, 'a')) {
            currentNode = currentNode.parentNode;
        }
        if (!currentNode) {
            return;
        }
        if (!_domUtilsDomExtend2['default'].isTag(currentNode, 'a')) {
            return;
        }
        _rangeUtilsRangeExtend2['default'].selectElementContents(currentNode);
        _commonEnv2['default'].doc.execCommand("unlink", false, false);
    }
};

exports['default'] = linkUtils;
module.exports = exports['default'];

},{"./../common/const":13,"./../common/env":15,"./../common/utils":19,"./../domUtils/domExtend":24,"./../rangeUtils/rangeExtend":36}],31:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", {
            value: true
});
var Markdown;

if (typeof exports === "object" && typeof require === "function") // we're in a CommonJS (e.g. Node.js) module
            Markdown = exports;else Markdown = {};

// The following text is included for historical reasons, but should
// be taken with a pinch of salt; it's not all true anymore.

//
// Wherever possible, Showdown is a straight, line-by-line port
// of the Perl version of Markdown.
//
// This is not a normal parser design; it's basically just a
// series of string substitutions.  It's hard to read and
// maintain this way,  but keeping Showdown close to the original
// design makes it easier to port new features.
//
// More importantly, Showdown behaves like markdown.pl in most
// edge cases.  So web applications can do client-side preview
// in Javascript, and then build identical HTML on the server.
//
// This port needs the new RegExp functionality of ECMA 262,
// 3rd Edition (i.e. Javascript 1.5).  Most modern web browsers
// should do fine.  Even with the new regular expression features,
// We do a lot of work to emulate Perl's regex functionality.
// The tricky changes in this file mostly have the "attacklab:"
// label.  Major or self-explanatory changes don't.
//
// Smart diff tools like Araxis Merge will be able to match up
// this file with markdown.pl in a useful way.  A little tweaking
// helps: in a copy of markdown.pl, replace "#" with "//" and
// replace "$text" with "text".  Be sure to ignore whitespace
// and line endings.
//

//
// Usage:
//
//   var text = "Markdown *rocks*.";
//
//   var converter = new Markdown.Converter();
//   var html = converter.makeHtml(text);
//
//   alert(html);
//
// Note: move the sample code to the bottom of this
// file before uncommenting it.
//

(function () {

            function identity(x) {
                        return x;
            }
            function returnFalse(x) {
                        return false;
            }

            function HookCollection() {}

            HookCollection.prototype = {

                        chain: function chain(hookname, func) {
                                    var original = this[hookname];
                                    if (!original) throw new Error("unknown hook " + hookname);

                                    if (original === identity) this[hookname] = func;else this[hookname] = function (text) {
                                                var args = Array.prototype.slice.call(arguments, 0);
                                                args[0] = original.apply(null, args);
                                                return func.apply(null, args);
                                    };
                        },
                        set: function set(hookname, func) {
                                    if (!this[hookname]) throw new Error("unknown hook " + hookname);
                                    this[hookname] = func;
                        },
                        addNoop: function addNoop(hookname) {
                                    this[hookname] = identity;
                        },
                        addFalse: function addFalse(hookname) {
                                    this[hookname] = returnFalse;
                        }
            };

            Markdown.HookCollection = HookCollection;

            // g_urls and g_titles allow arbitrary user-entered strings as keys. This
            // caused an exception (and hence stopped the rendering) when the user entered
            // e.g. [push] or [__proto__]. Adding a prefix to the actual key prevents this
            // (since no builtin property starts with "s_"). See
            // http://meta.stackexchange.com/questions/64655/strange-wmd-bug
            // (granted, switching from Array() to Object() alone would have left only __proto__
            // to be a problem)
            function SaveHash() {}
            SaveHash.prototype = {
                        set: function set(key, value) {
                                    this["s_" + key] = value;
                        },
                        get: function get(key) {
                                    return this["s_" + key];
                        }
            };

            Markdown.Converter = function (OPTIONS) {
                        var pluginHooks = this.hooks = new HookCollection();

                        // given a URL that was encountered by itself (without markup), should return the link text that's to be given to this link
                        pluginHooks.addNoop("plainLinkText");

                        // called with the orignal text as given to makeHtml. The result of this plugin hook is the actual markdown source that will be cooked
                        pluginHooks.addNoop("preConversion");

                        // called with the text once all normalizations have been completed (tabs to spaces, line endings, etc.), but before any conversions have
                        pluginHooks.addNoop("postNormalization");

                        // Called with the text before / after creating block elements like code blocks and lists. Note that this is called recursively
                        // with inner content, e.g. it's called with the full text, and then only with the content of a blockquote. The inner
                        // call will receive outdented text.
                        pluginHooks.addNoop("preBlockGamut");
                        pluginHooks.addNoop("postBlockGamut");

                        // called with the text of a single block element before / after the span-level conversions (bold, code spans, etc.) have been made
                        pluginHooks.addNoop("preSpanGamut");
                        pluginHooks.addNoop("postSpanGamut");

                        // called with the final cooked HTML code. The result of this plugin hook is the actual output of makeHtml
                        pluginHooks.addNoop("postConversion");

                        //
                        // Private state of the converter instance:
                        //

                        // Global hashes, used by various utility routines
                        var g_urls;
                        var g_titles;
                        var g_html_blocks;

                        // Used to track when we're inside an ordered or unordered list
                        // (see _ProcessListItems() for details):
                        var g_list_level;

                        OPTIONS = OPTIONS || {};
                        var asciify = identity,
                            deasciify = identity;
                        if (OPTIONS.nonAsciiLetters) {

                                    /* In JavaScript regular expressions, \w only denotes [a-zA-Z0-9_].
                                     * That's why there's inconsistent handling e.g. with intra-word bolding
                                     * of Japanese words. That's why we do the following if OPTIONS.nonAsciiLetters
                                     * is true:
                                     *
                                     * Before doing bold and italics, we find every instance
                                     * of a unicode word character in the Markdown source that is not
                                     * matched by \w, and the letter "Q". We take the character's code point
                                     * and encode it in base 51, using the "digits"
                                     *
                                     *     A, B, ..., P, R, ..., Y, Z, a, b, ..., y, z
                                     *
                                     * delimiting it with "Q" on both sides. For example, the source
                                     *
                                     * > In Chinese, the smurfs are called 藍精靈, meaning "blue spirits".
                                     *
                                     * turns into
                                     *
                                     * > In Chinese, the smurfs are called QNIhQQMOIQQOuUQ, meaning "blue spirits".
                                     *
                                     * Since everything that is a letter in Unicode is now a letter (or
                                     * several letters) in ASCII, \w and \b should always do the right thing.
                                     *
                                     * After the bold/italic conversion, we decode again; since "Q" was encoded
                                     * alongside all non-ascii characters (as "QBfQ"), and the conversion
                                     * will not generate "Q", the only instances of that letter should be our
                                     * encoded characters. And since the conversion will not break words, the
                                     * "Q...Q" should all still be in one piece.
                                     *
                                     * We're using "Q" as the delimiter because it's probably one of the
                                     * rarest characters, and also because I can't think of any special behavior
                                     * that would ever be triggered by this letter (to use a silly example, if we
                                     * delimited with "H" on the left and "P" on the right, then "Ψ" would be
                                     * encoded as "HTTP", which may cause special behavior). The latter would not
                                     * actually be a huge issue for bold/italic, but may be if we later use it
                                     * in other places as well.
                                     * */
                                    (function () {
                                                var lettersThatJavaScriptDoesNotKnowAndQ = /[Q\u00aa\u00b5\u00ba\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376-\u0377\u037a-\u037d\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u0523\u0531-\u0556\u0559\u0561-\u0587\u05d0-\u05ea\u05f0-\u05f2\u0621-\u064a\u0660-\u0669\u066e-\u066f\u0671-\u06d3\u06d5\u06e5-\u06e6\u06ee-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07c0-\u07ea\u07f4-\u07f5\u07fa\u0904-\u0939\u093d\u0950\u0958-\u0961\u0966-\u096f\u0971-\u0972\u097b-\u097f\u0985-\u098c\u098f-\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc-\u09dd\u09df-\u09e1\u09e6-\u09f1\u0a05-\u0a0a\u0a0f-\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32-\u0a33\u0a35-\u0a36\u0a38-\u0a39\u0a59-\u0a5c\u0a5e\u0a66-\u0a6f\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2-\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0-\u0ae1\u0ae6-\u0aef\u0b05-\u0b0c\u0b0f-\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32-\u0b33\u0b35-\u0b39\u0b3d\u0b5c-\u0b5d\u0b5f-\u0b61\u0b66-\u0b6f\u0b71\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99-\u0b9a\u0b9c\u0b9e-\u0b9f\u0ba3-\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0be6-\u0bef\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c33\u0c35-\u0c39\u0c3d\u0c58-\u0c59\u0c60-\u0c61\u0c66-\u0c6f\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cde\u0ce0-\u0ce1\u0ce6-\u0cef\u0d05-\u0d0c\u0d0e-\u0d10\u0d12-\u0d28\u0d2a-\u0d39\u0d3d\u0d60-\u0d61\u0d66-\u0d6f\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0e01-\u0e30\u0e32-\u0e33\u0e40-\u0e46\u0e50-\u0e59\u0e81-\u0e82\u0e84\u0e87-\u0e88\u0e8a\u0e8d\u0e94-\u0e97\u0e99-\u0e9f\u0ea1-\u0ea3\u0ea5\u0ea7\u0eaa-\u0eab\u0ead-\u0eb0\u0eb2-\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0ed0-\u0ed9\u0edc-\u0edd\u0f00\u0f20-\u0f29\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8b\u1000-\u102a\u103f-\u1049\u1050-\u1055\u105a-\u105d\u1061\u1065-\u1066\u106e-\u1070\u1075-\u1081\u108e\u1090-\u1099\u10a0-\u10c5\u10d0-\u10fa\u10fc\u1100-\u1159\u115f-\u11a2\u11a8-\u11f9\u1200-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1380-\u138f\u13a0-\u13f4\u1401-\u166c\u166f-\u1676\u1681-\u169a\u16a0-\u16ea\u1700-\u170c\u170e-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u17e0-\u17e9\u1810-\u1819\u1820-\u1877\u1880-\u18a8\u18aa\u1900-\u191c\u1946-\u196d\u1970-\u1974\u1980-\u19a9\u19c1-\u19c7\u19d0-\u19d9\u1a00-\u1a16\u1b05-\u1b33\u1b45-\u1b4b\u1b50-\u1b59\u1b83-\u1ba0\u1bae-\u1bb9\u1c00-\u1c23\u1c40-\u1c49\u1c4d-\u1c7d\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u203f-\u2040\u2054\u2071\u207f\u2090-\u2094\u2102\u2107\u210a-\u2113\u2115\u2119-\u211d\u2124\u2126\u2128\u212a-\u212d\u212f-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2183-\u2184\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2c6f\u2c71-\u2c7d\u2c80-\u2ce4\u2d00-\u2d25\u2d30-\u2d65\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u2e2f\u3005-\u3006\u3031-\u3035\u303b-\u303c\u3041-\u3096\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312d\u3131-\u318e\u31a0-\u31b7\u31f0-\u31ff\u3400-\u4db5\u4e00-\u9fc3\ua000-\ua48c\ua500-\ua60c\ua610-\ua62b\ua640-\ua65f\ua662-\ua66e\ua67f-\ua697\ua717-\ua71f\ua722-\ua788\ua78b-\ua78c\ua7fb-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua840-\ua873\ua882-\ua8b3\ua8d0-\ua8d9\ua900-\ua925\ua930-\ua946\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa50-\uaa59\uac00-\ud7a3\uf900-\ufa2d\ufa30-\ufa6a\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40-\ufb41\ufb43-\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe33-\ufe34\ufe4d-\ufe4f\ufe70-\ufe74\ufe76-\ufefc\uff10-\uff19\uff21-\uff3a\uff3f\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc]/g;
                                                var cp_Q = "Q".charCodeAt(0);
                                                var cp_A = "A".charCodeAt(0);
                                                var cp_Z = "Z".charCodeAt(0);
                                                var dist_Za = "a".charCodeAt(0) - cp_Z - 1;

                                                asciify = function (text) {
                                                            return text.replace(lettersThatJavaScriptDoesNotKnowAndQ, function (m) {
                                                                        var c = m.charCodeAt(0);
                                                                        var s = "";
                                                                        var v;
                                                                        while (c > 0) {
                                                                                    v = c % 51 + cp_A;
                                                                                    if (v >= cp_Q) v++;
                                                                                    if (v > cp_Z) v += dist_Za;
                                                                                    s = String.fromCharCode(v) + s;
                                                                                    c = c / 51 | 0;
                                                                        }
                                                                        return "Q" + s + "Q";
                                                            });
                                                };

                                                deasciify = function (text) {
                                                            return text.replace(/Q([A-PR-Za-z]{1,3})Q/g, function (m, s) {
                                                                        var c = 0;
                                                                        var v;
                                                                        for (var i = 0; i < s.length; i++) {
                                                                                    v = s.charCodeAt(i);
                                                                                    if (v > cp_Z) v -= dist_Za;
                                                                                    if (v > cp_Q) v--;
                                                                                    v -= cp_A;
                                                                                    c = c * 51 + v;
                                                                        }
                                                                        return String.fromCharCode(c);
                                                            });
                                                };
                                    })();
                        }

                        var _DoItalicsAndBold = OPTIONS.asteriskIntraWordEmphasis ? _DoItalicsAndBold_AllowIntrawordWithAsterisk : _DoItalicsAndBoldStrict;

                        this.makeHtml = function (text) {

                                    //
                                    // Main function. The order in which other subs are called here is
                                    // essential. Link and image substitutions need to happen before
                                    // _EscapeSpecialCharsWithinTagAttributes(), so that any *'s or _'s in the <a>
                                    // and <img> tags get encoded.
                                    //

                                    // This will only happen if makeHtml on the same converter instance is called from a plugin hook.
                                    // Don't do that.
                                    if (g_urls) throw new Error("Recursive call to converter.makeHtml");

                                    // Create the private state objects.
                                    g_urls = new SaveHash();
                                    g_titles = new SaveHash();
                                    g_html_blocks = [];
                                    g_list_level = 0;

                                    text = pluginHooks.preConversion(text);

                                    // attacklab: Replace ~ with ~T
                                    // This lets us use tilde as an escape char to avoid md5 hashes
                                    // The choice of character is arbitray; anything that isn't
                                    // magic in Markdown will work.
                                    text = text.replace(/~/g, "~T");

                                    // attacklab: Replace $ with ~D
                                    // RegExp interprets $ as a special character
                                    // when it's in a replacement string
                                    text = text.replace(/\$/g, "~D");

                                    // Standardize line endings
                                    text = text.replace(/\r\n/g, "\n"); // DOS to Unix
                                    text = text.replace(/\r/g, "\n"); // Mac to Unix

                                    // Make sure text begins and ends with a couple of newlines:
                                    text = "\n\n" + text + "\n\n";

                                    // Convert all tabs to spaces.
                                    text = _Detab(text);

                                    // Strip any lines consisting only of spaces and tabs.
                                    // This makes subsequent regexen easier to write, because we can
                                    // match consecutive blank lines with /\n+/ instead of something
                                    // contorted like /[ \t]*\n+/ .
                                    text = text.replace(/^[ \t]+$/mg, "");

                                    text = pluginHooks.postNormalization(text);

                                    // Turn block-level HTML blocks into hash entries
                                    text = _HashHTMLBlocks(text);

                                    // Strip link definitions, store in hashes.
                                    text = _StripLinkDefinitions(text);

                                    text = _RunBlockGamut(text);

                                    text = _UnescapeSpecialChars(text);

                                    // attacklab: Restore dollar signs
                                    text = text.replace(/~D/g, "$$");

                                    // attacklab: Restore tildes
                                    text = text.replace(/~T/g, "~");

                                    text = pluginHooks.postConversion(text);

                                    g_html_blocks = g_titles = g_urls = null;

                                    return text;
                        };

                        function _StripLinkDefinitions(text) {
                                    //
                                    // Strips link definitions from text, stores the URLs and titles in
                                    // hash references.
                                    //

                                    // Link defs are in the form: ^[id]: url "optional title"

                                    /*
                                     text = text.replace(/
                                     ^[ ]{0,3}\[([^\[\]]+)\]:  // id = $1  attacklab: g_tab_width - 1
                                     [ \t]*
                                     \n?                 // maybe *one* newline
                                     [ \t]*
                                     <?(\S+?)>?          // url = $2
                                     (?=\s|$)            // lookahead for whitespace instead of the lookbehind removed below
                                     [ \t]*
                                     \n?                 // maybe one newline
                                     [ \t]*
                                     (                   // (potential) title = $3
                                     (\n*)           // any lines skipped = $4 attacklab: lookbehind removed
                                     [ \t]+
                                     ["(]
                                     (.+?)           // title = $5
                                     [")]
                                     [ \t]*
                                     )?                  // title is optional
                                     (\n+)             // subsequent newlines = $6, capturing because they must be put back if the potential title isn't an actual title
                                     /gm, function(){...});
                                     */

                                    text = text.replace(/^[ ]{0,3}\[([^\[\]]+)\]:[ \t]*\n?[ \t]*<?(\S+?)>?(?=\s|$)[ \t]*\n?[ \t]*((\n*)["(](.+?)[")][ \t]*)?(\n+)/gm, function (wholeMatch, m1, m2, m3, m4, m5, m6) {
                                                m1 = m1.toLowerCase();
                                                g_urls.set(m1, _EncodeAmpsAndAngles(m2)); // Link IDs are case-insensitive
                                                if (m4) {
                                                            // Oops, found blank lines, so it's not a title.
                                                            // Put back the parenthetical statement we stole.
                                                            return m3 + m6;
                                                } else if (m5) {
                                                            g_titles.set(m1, m5.replace(/"/g, "&quot;"));
                                                }

                                                // Completely remove the definition from the text
                                                return "";
                                    });

                                    return text;
                        }

                        function _HashHTMLBlocks(text) {

                                    // Hashify HTML blocks:
                                    // We only want to do this for block-level HTML tags, such as headers,
                                    // lists, and tables. That's because we still want to wrap <p>s around
                                    // "paragraphs" that are wrapped in non-block-level tags, such as anchors,
                                    // phrase emphasis, and spans. The list of tags we're looking for is
                                    // hard-coded:
                                    var block_tags_a = "p|div|h[1-6]|blockquote|pre|table|dl|ol|ul|script|noscript|form|fieldset|iframe|math|ins|del";
                                    var block_tags_b = "p|div|h[1-6]|blockquote|pre|table|dl|ol|ul|script|noscript|form|fieldset|iframe|math";

                                    // First, look for nested blocks, e.g.:
                                    //   <div>
                                    //     <div>
                                    //     tags for inner block must be indented.
                                    //     </div>
                                    //   </div>
                                    //
                                    // The outermost tags must start at the left margin for this to match, and
                                    // the inner nested divs must be indented.
                                    // We need to do this before the next, more liberal match, because the next
                                    // match will start at the first `<div>` and stop at the first `</div>`.

                                    // attacklab: This regex can be expensive when it fails.

                                    /*
                                     text = text.replace(/
                                     (                       // save in $1
                                     ^                   // start of line  (with /m)
                                     <($block_tags_a)    // start tag = $2
                                     \b                  // word break
                                     // attacklab: hack around khtml/pcre bug...
                                     [^\r]*?\n           // any number of lines, minimally matching
                                     </\2>               // the matching end tag
                                     [ \t]*              // trailing spaces/tabs
                                     (?=\n+)             // followed by a newline
                                     )                       // attacklab: there are sentinel newlines at end of document
                                     /gm,function(){...}};
                                     */
                                    text = text.replace(/^(<(p|div|h[1-6]|blockquote|pre|table|dl|ol|ul|script|noscript|form|fieldset|iframe|math|ins|del)\b[^\r]*?\n<\/\2>[ \t]*(?=\n+))/gm, hashMatch);

                                    //
                                    // Now match more liberally, simply from `\n<tag>` to `</tag>\n`
                                    //

                                    /*
                                     text = text.replace(/
                                     (                       // save in $1
                                     ^                   // start of line  (with /m)
                                     <($block_tags_b)    // start tag = $2
                                     \b                  // word break
                                     // attacklab: hack around khtml/pcre bug...
                                     [^\r]*?             // any number of lines, minimally matching
                                     .*</\2>             // the matching end tag
                                     [ \t]*              // trailing spaces/tabs
                                     (?=\n+)             // followed by a newline
                                     )                       // attacklab: there are sentinel newlines at end of document
                                     /gm,function(){...}};
                                     */
                                    text = text.replace(/^(<(p|div|h[1-6]|blockquote|pre|table|dl|ol|ul|script|noscript|form|fieldset|iframe|math)\b[^\r]*?.*<\/\2>[ \t]*(?=\n+)\n)/gm, hashMatch);

                                    // Special case just for <hr />. It was easier to make a special case than
                                    // to make the other regex more complicated.

                                    /*
                                     text = text.replace(/
                                     \n                  // Starting after a blank line
                                     [ ]{0,3}
                                     (                   // save in $1
                                     (<(hr)          // start tag = $2
                                     \b          // word break
                                     ([^<>])*?
                                     \/?>)           // the matching end tag
                                     [ \t]*
                                     (?=\n{2,})      // followed by a blank line
                                     )
                                     /g,hashMatch);
                                     */
                                    text = text.replace(/\n[ ]{0,3}((<(hr)\b([^<>])*?\/?>)[ \t]*(?=\n{2,}))/g, hashMatch);

                                    // Special case for standalone HTML comments:

                                    /*
                                     text = text.replace(/
                                     \n\n                                            // Starting after a blank line
                                     [ ]{0,3}                                        // attacklab: g_tab_width - 1
                                     (                                               // save in $1
                                     <!
                                     (--(?:|(?:[^>-]|-[^>])(?:[^-]|-[^-])*)--)   // see http://www.w3.org/TR/html-markup/syntax.html#comments and http://meta.stackexchange.com/q/95256
                                     >
                                     [ \t]*
                                     (?=\n{2,})                                  // followed by a blank line
                                     )
                                     /g,hashMatch);
                                     */
                                    text = text.replace(/\n\n[ ]{0,3}(<!(--(?:|(?:[^>-]|-[^>])(?:[^-]|-[^-])*)--)>[ \t]*(?=\n{2,}))/g, hashMatch);

                                    // PHP and ASP-style processor instructions (<?...?> and <%...%>)

                                    /*
                                     text = text.replace(/
                                     (?:
                                     \n\n            // Starting after a blank line
                                     )
                                     (                   // save in $1
                                     [ ]{0,3}        // attacklab: g_tab_width - 1
                                     (?:
                                     <([?%])     // $2
                                     [^\r]*?
                                     \2>
                                     )
                                     [ \t]*
                                     (?=\n{2,})      // followed by a blank line
                                     )
                                     /g,hashMatch);
                                     */
                                    text = text.replace(/(?:\n\n)([ ]{0,3}(?:<([?%])[^\r]*?\2>)[ \t]*(?=\n{2,}))/g, hashMatch);

                                    return text;
                        }

                        function hashBlock(text) {
                                    text = text.replace(/(^\n+|\n+$)/g, "");
                                    // Replace the element text with a marker ("~KxK" where x is its key)
                                    return "\n\n~K" + (g_html_blocks.push(text) - 1) + "K\n\n";
                        }

                        function hashMatch(wholeMatch, m1) {
                                    return hashBlock(m1);
                        }

                        var blockGamutHookCallback = function blockGamutHookCallback(t) {
                                    return _RunBlockGamut(t);
                        };

                        function _RunBlockGamut(text, doNotUnhash, doNotCreateParagraphs) {
                                    //
                                    // These are all the transformations that form block-level
                                    // tags like paragraphs, headers, and list items.
                                    //

                                    text = pluginHooks.preBlockGamut(text, blockGamutHookCallback);

                                    text = _DoHeaders(text);

                                    // Do Horizontal Rules:
                                    var replacement = "<hr />\n";
                                    text = text.replace(/^[ ]{0,2}([ ]?\*[ ]?){3,}[ \t]*$/gm, replacement);
                                    text = text.replace(/^[ ]{0,2}([ ]?-[ ]?){3,}[ \t]*$/gm, replacement);
                                    text = text.replace(/^[ ]{0,2}([ ]?_[ ]?){3,}[ \t]*$/gm, replacement);

                                    text = _DoLists(text);
                                    text = _DoCodeBlocks(text);
                                    text = _DoBlockQuotes(text);

                                    text = pluginHooks.postBlockGamut(text, blockGamutHookCallback);

                                    // We already ran _HashHTMLBlocks() before, in Markdown(), but that
                                    // was to escape raw HTML in the original Markdown source. This time,
                                    // we're escaping the markup we've just created, so that we don't wrap
                                    // <p> tags around block-level tags.
                                    text = _HashHTMLBlocks(text);

                                    text = _FormParagraphs(text, doNotUnhash, doNotCreateParagraphs);

                                    return text;
                        }

                        function _RunSpanGamut(text) {
                                    //
                                    // These are all the transformations that occur *within* block-level
                                    // tags like paragraphs, headers, and list items.
                                    //

                                    text = pluginHooks.preSpanGamut(text);

                                    text = _DoCodeSpans(text);
                                    text = _EscapeSpecialCharsWithinTagAttributes(text);
                                    text = _EncodeBackslashEscapes(text);

                                    // Process anchor and image tags. Images must come first,
                                    // because ![foo][f] looks like an anchor.
                                    text = _DoImages(text);
                                    text = _DoAnchors(text);

                                    // Make links out of things like `<http://example.com/>`
                                    // Must come after _DoAnchors(), because you can use < and >
                                    // delimiters in inline links like [this](<url>).
                                    text = _DoAutoLinks(text);

                                    text = text.replace(/~P/g, "://"); // put in place to prevent autolinking; reset now

                                    text = _EncodeAmpsAndAngles(text);
                                    text = _DoItalicsAndBold(text);

                                    // Do hard breaks:
                                    text = text.replace(/  +\n/g, " <br>\n");

                                    text = pluginHooks.postSpanGamut(text);

                                    return text;
                        }

                        function _EscapeSpecialCharsWithinTagAttributes(text) {
                                    //
                                    // Within tags -- meaning between < and > -- encode [\ ` * _] so they
                                    // don't conflict with their use in Markdown for code, italics and strong.
                                    //

                                    // Build a regex to find HTML tags and comments.  See Friedl's
                                    // "Mastering Regular Expressions", 2nd Ed., pp. 200-201.

                                    // SE: changed the comment part of the regex

                                    var regex = /(<[a-z\/!$]("[^"]*"|'[^']*'|[^'">])*>|<!(--(?:|(?:[^>-]|-[^>])(?:[^-]|-[^-])*)--)>)/gi;

                                    text = text.replace(regex, function (wholeMatch) {
                                                var tag = wholeMatch.replace(/(.)<\/?code>(?=.)/g, "$1`");
                                                tag = escapeCharacters(tag, wholeMatch.charAt(1) == "!" ? "\\`*_/" : "\\`*_"); // also escape slashes in comments to prevent autolinking there -- http://meta.stackexchange.com/questions/95987
                                                return tag;
                                    });

                                    return text;
                        }

                        function _DoAnchors(text) {

                                    if (text.indexOf("[") === -1) return text;

                                    //
                                    // Turn Markdown link shortcuts into XHTML <a> tags.
                                    //
                                    //
                                    // First, handle reference-style links: [link text] [id]
                                    //

                                    /*
                                     text = text.replace(/
                                     (                           // wrap whole match in $1
                                     \[
                                     (
                                     (?:
                                     \[[^\]]*\]      // allow brackets nested one level
                                     |
                                     [^\[]           // or anything else
                                     )*
                                     )
                                     \]
                                     [ ]?                    // one optional space
                                     (?:\n[ ]*)?             // one optional newline followed by spaces
                                     \[
                                     (.*?)                   // id = $3
                                     \]
                                     )
                                     ()()()()                    // pad remaining backreferences
                                     /g, writeAnchorTag);
                                     */
                                    text = text.replace(/(\[((?:\[[^\]]*\]|[^\[\]])*)\][ ]?(?:\n[ ]*)?\[(.*?)\])()()()()/g, writeAnchorTag);

                                    //
                                    // Next, inline-style links: [link text](url "optional title")
                                    //

                                    /*
                                     text = text.replace(/
                                     (                           // wrap whole match in $1
                                     \[
                                     (
                                     (?:
                                     \[[^\]]*\]      // allow brackets nested one level
                                     |
                                     [^\[\]]         // or anything else
                                     )*
                                     )
                                     \]
                                     \(                      // literal paren
                                     [ \t]*
                                     ()                      // no id, so leave $3 empty
                                     <?(                     // href = $4
                                     (?:
                                     \([^)]*\)       // allow one level of (correctly nested) parens (think MSDN)
                                     |
                                     [^()\s]
                                     )*?
                                     )>?
                                     [ \t]*
                                     (                       // $5
                                     (['"])              // quote char = $6
                                     (.*?)               // Title = $7
                                     \6                  // matching quote
                                     [ \t]*              // ignore any spaces/tabs between closing quote and )
                                     )?                      // title is optional
                                     \)
                                     )
                                     /g, writeAnchorTag);
                                     */

                                    text = text.replace(/(\[((?:\[[^\]]*\]|[^\[\]])*)\]\([ \t]*()<?((?:\([^)]*\)|[^()\s])*?)>?[ \t]*((['"])(.*?)\6[ \t]*)?\))/g, writeAnchorTag);

                                    //
                                    // Last, handle reference-style shortcuts: [link text]
                                    // These must come last in case you've also got [link test][1]
                                    // or [link test](/foo)
                                    //

                                    /*
                                     text = text.replace(/
                                     (                   // wrap whole match in $1
                                     \[
                                     ([^\[\]]+)      // link text = $2; can't contain '[' or ']'
                                     \]
                                     )
                                     ()()()()()          // pad rest of backreferences
                                     /g, writeAnchorTag);
                                     */
                                    text = text.replace(/(\[([^\[\]]+)\])()()()()()/g, writeAnchorTag);

                                    return text;
                        }

                        function writeAnchorTag(wholeMatch, m1, m2, m3, m4, m5, m6, m7) {
                                    if (m7 == undefined) m7 = "";
                                    var whole_match = m1;
                                    var link_text = m2.replace(/:\/\//g, "~P"); // to prevent auto-linking withing the link. will be converted back after the auto-linker runs
                                    var link_id = m3.toLowerCase();
                                    var url = m4;
                                    var title = m7;

                                    if (url == "") {
                                                if (link_id == "") {
                                                            // lower-case and turn embedded newlines into spaces
                                                            link_id = link_text.toLowerCase().replace(/ ?\n/g, " ");
                                                }
                                                url = "#" + link_id;

                                                if (g_urls.get(link_id) != undefined) {
                                                            url = g_urls.get(link_id);
                                                            if (g_titles.get(link_id) != undefined) {
                                                                        title = g_titles.get(link_id);
                                                            }
                                                } else {
                                                            if (whole_match.search(/\(\s*\)$/m) > -1) {
                                                                        // Special case for explicit empty url
                                                                        url = "";
                                                            } else {
                                                                        return whole_match;
                                                            }
                                                }
                                    }
                                    url = attributeSafeUrl(url);

                                    var result = "<a href=\"" + url + "\"";

                                    if (title != "") {
                                                title = attributeEncode(title);
                                                title = escapeCharacters(title, "*_");
                                                result += " title=\"" + title + "\"";
                                    }

                                    result += ">" + link_text + "</a>";

                                    return result;
                        }

                        function _DoImages(text) {

                                    if (text.indexOf("![") === -1) return text;

                                    //
                                    // Turn Markdown image shortcuts into <img> tags.
                                    //

                                    //
                                    // First, handle reference-style labeled images: ![alt text][id]
                                    //

                                    /*
                                     text = text.replace(/
                                     (                   // wrap whole match in $1
                                     !\[
                                     (.*?)           // alt text = $2
                                     \]
                                     [ ]?            // one optional space
                                     (?:\n[ ]*)?     // one optional newline followed by spaces
                                     \[
                                     (.*?)           // id = $3
                                     \]
                                     )
                                     ()()()()            // pad rest of backreferences
                                     /g, writeImageTag);
                                     */
                                    text = text.replace(/(!\[(.*?)\][ ]?(?:\n[ ]*)?\[(.*?)\])()()()()/g, writeImageTag);

                                    //
                                    // Next, handle inline images:  ![alt text](url "optional title")
                                    // Don't forget: encode * and _

                                    /*
                                     text = text.replace(/
                                     (                   // wrap whole match in $1
                                     !\[
                                     (.*?)           // alt text = $2
                                     \]
                                     \s?             // One optional whitespace character
                                     \(              // literal paren
                                     [ \t]*
                                     ()              // no id, so leave $3 empty
                                     <?(\S+?)>?      // src url = $4
                                     [ \t]*
                                     (               // $5
                                     (['"])      // quote char = $6
                                     (.*?)       // title = $7
                                     \6          // matching quote
                                     [ \t]*
                                     )?              // title is optional
                                     \)
                                     )
                                     /g, writeImageTag);
                                     */
                                    text = text.replace(/(!\[(.*?)\]\s?\([ \t]*()<?(\S+?)>?[ \t]*((['"])(.*?)\6[ \t]*)?\))/g, writeImageTag);

                                    return text;
                        }

                        function attributeEncode(text) {
                                    // unconditionally replace angle brackets here -- what ends up in an attribute (e.g. alt or title)
                                    // never makes sense to have verbatim HTML in it (and the sanitizer would totally break it)
                                    return text.replace(/>/g, "&gt;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
                        }

                        function writeImageTag(wholeMatch, m1, m2, m3, m4, m5, m6, m7) {
                                    var whole_match = m1;
                                    var alt_text = m2;
                                    var link_id = m3.toLowerCase();
                                    var url = m4;
                                    var title = m7;

                                    if (!title) title = "";

                                    if (url == "") {
                                                if (link_id == "") {
                                                            // lower-case and turn embedded newlines into spaces
                                                            link_id = alt_text.toLowerCase().replace(/ ?\n/g, " ");
                                                }
                                                url = "#" + link_id;

                                                if (g_urls.get(link_id) != undefined) {
                                                            url = g_urls.get(link_id);
                                                            if (g_titles.get(link_id) != undefined) {
                                                                        title = g_titles.get(link_id);
                                                            }
                                                } else {
                                                            return whole_match;
                                                }
                                    }

                                    alt_text = escapeCharacters(attributeEncode(alt_text), "*_[]()");
                                    url = escapeCharacters(url, "*_");
                                    var result = "<img src=\"" + url + "\" alt=\"" + alt_text + "\"";

                                    // attacklab: Markdown.pl adds empty title attributes to images.
                                    // Replicate this bug.

                                    //if (title != "") {
                                    title = attributeEncode(title);
                                    title = escapeCharacters(title, "*_");
                                    result += " title=\"" + title + "\"";
                                    //}

                                    result += " />";

                                    return result;
                        }

                        function _DoHeaders(text) {

                                    // Setext-style headers:
                                    //  Header 1
                                    //  ========
                                    //
                                    //  Header 2
                                    //  --------
                                    //
                                    text = text.replace(/^(.+)[ \t]*\n=+[ \t]*\n+/gm, function (wholeMatch, m1) {
                                                return "<h1>" + _RunSpanGamut(m1) + "</h1>\n\n";
                                    });

                                    text = text.replace(/^(.+)[ \t]*\n-+[ \t]*\n+/gm, function (matchFound, m1) {
                                                return "<h2>" + _RunSpanGamut(m1) + "</h2>\n\n";
                                    });

                                    // atx-style headers:
                                    //  # Header 1
                                    //  ## Header 2
                                    //  ## Header 2 with closing hashes ##
                                    //  ...
                                    //  ###### Header 6
                                    //

                                    /*
                                     text = text.replace(/
                                     ^(\#{1,6})      // $1 = string of #'s
                                     [ \t]*
                                     (.+?)           // $2 = Header text
                                     [ \t]*
                                     \#*             // optional closing #'s (not counted)
                                     \n+
                                     /gm, function() {...});
                                     */

                                    text = text.replace(/^(\#{1,6})[ \t]*(.+?)[ \t]*\#*\n+/gm, function (wholeMatch, m1, m2) {
                                                var h_level = m1.length;
                                                return "<h" + h_level + ">" + _RunSpanGamut(m2) + "</h" + h_level + ">\n\n";
                                    });

                                    return text;
                        }

                        function _DoLists(text, isInsideParagraphlessListItem) {
                                    //
                                    // Form HTML ordered (numbered) and unordered (bulleted) lists.
                                    //

                                    // attacklab: add sentinel to hack around khtml/safari bug:
                                    // http://bugs.webkit.org/show_bug.cgi?id=11231
                                    text += "~0";

                                    // Re-usable pattern to match any entirel ul or ol list:

                                    /*
                                     var whole_list = /
                                     (                                   // $1 = whole list
                                     (                               // $2
                                     [ ]{0,3}                    // attacklab: g_tab_width - 1
                                     ([*+-]|\d+[.])              // $3 = first list item marker
                                     [ \t]+
                                     )
                                     [^\r]+?
                                     (                               // $4
                                     ~0                          // sentinel for workaround; should be $
                                     |
                                     \n{2,}
                                     (?=\S)
                                     (?!                         // Negative lookahead for another list item marker
                                     [ \t]*
                                     (?:[*+-]|\d+[.])[ \t]+
                                     )
                                     )
                                     )
                                     /g
                                     */
                                    var whole_list = /^(([ ]{0,3}([*+-]|\d+[.])[ \t]+)[^\r]+?(~0|\n{2,}(?=\S)(?![ \t]*(?:[*+-]|\d+[.])[ \t]+)))/gm;
                                    var list_type;
                                    if (g_list_level) {
                                                text = text.replace(whole_list, function (wholeMatch, m1, m2) {
                                                            var list = m1;
                                                            list_type = getListType(m2);
                                                            //2015-10-22 wiz：删除起始序列号 支持
                                                            //var first_number;
                                                            //if (list_type === "ol")
                                                            //    first_number = parseInt(m2, 10)

                                                            var result = _ProcessListItems(list, list_type, isInsideParagraphlessListItem);

                                                            // Trim any trailing whitespace, to put the closing `</$list_type>`
                                                            // up on the preceding line, to get it past the current stupid
                                                            // HTML block parser. This is a hack to work around the terrible
                                                            // hack that is the HTML block parser.
                                                            var resultStr = result.list_str.replace(/\s+$/, "");
                                                            var opening = "<" + list_type;
                                                            //if (first_number && first_number !== 1)
                                                            //    opening += " start=\"" + first_number + "\"";
                                                            resultStr = opening + ">" + resultStr + "</" + result.list_type + ">\n";
                                                            list_type = result.list_type;
                                                            return resultStr;
                                                });
                                    } else {
                                                whole_list = /(\n\n|^\n?)(([ ]{0,3}([*+-]|\d+[.])[ \t]+)[^\r]+?(~0|\n{2,}(?=\S)(?![ \t]*(?:[*+-]|\d+[.])[ \t]+)))/gm;
                                                text = text.replace(whole_list, function (wholeMatch, m1, m2, m3) {
                                                            var runup = m1;
                                                            var list = m2;
                                                            list_type = getListType(m3);
                                                            //2015-10-22 wiz：删除起始序列号 支持
                                                            //var first_number;
                                                            //if (list_type === "ol")
                                                            //    first_number = parseInt(m3, 10)

                                                            var result = _ProcessListItems(list, list_type);

                                                            var opening = "<" + list_type;
                                                            //if (first_number && first_number !== 1)
                                                            //    opening += " start=\"" + first_number + "\"";

                                                            var resultStr = runup + opening + ">\n" + result.list_str + "</" + result.list_type + ">\n";
                                                            list_type = result.list_type;
                                                            return resultStr;
                                                });
                                    }

                                    // attacklab: strip sentinel
                                    text = text.replace(/~0/, "");

                                    return text;
                        }

                        var _listItemMarkers = { ol: "\\d+[.]", ul: "[*+-]" };

                        function getListType(str) {
                                    return str.search(/[*+-]/g) > -1 ? "ul" : "ol";
                        }

                        function _ProcessListItems(list_str, list_type, isInsideParagraphlessListItem) {
                                    //
                                    //  Process the contents of a single ordered or unordered list, splitting it
                                    //  into individual list items.
                                    //
                                    //  list_type is either "ul" or "ol".

                                    // The $g_list_level global keeps track of when we're inside a list.
                                    // Each time we enter a list, we increment it; when we leave a list,
                                    // we decrement. If it's zero, we're not in a list anymore.
                                    //
                                    // We do this because when we're not inside a list, we want to treat
                                    // something like this:
                                    //
                                    //    I recommend upgrading to version
                                    //    8. Oops, now this line is treated
                                    //    as a sub-list.
                                    //
                                    // As a single paragraph, despite the fact that the second line starts
                                    // with a digit-period-space sequence.
                                    //
                                    // Whereas when we're inside a list (or sub-list), that line will be
                                    // treated as the start of a sub-list. What a kludge, huh? This is
                                    // an aspect of Markdown's syntax that's hard to parse perfectly
                                    // without resorting to mind-reading. Perhaps the solution is to
                                    // change the syntax rules such that sub-lists must start with a
                                    // starting cardinal number; e.g. "1." or "a.".

                                    g_list_level++;

                                    // trim trailing blank lines:
                                    list_str = list_str.replace(/\n{2,}$/, "\n");

                                    // attacklab: add sentinel to emulate \z
                                    list_str += "~0";

                                    // In the original attacklab showdown, list_type was not given to this function, and anything
                                    // that matched /[*+-]|\d+[.]/ would just create the next <li>, causing this mismatch:
                                    //
                                    //  Markdown          rendered by WMD        rendered by MarkdownSharp
                                    //  ------------------------------------------------------------------
                                    //  1. first          1. first               1. first
                                    //  2. second         2. second              2. second
                                    //  - third           3. third                   * third
                                    //
                                    // We changed this to behave identical to MarkdownSharp. This is the constructed RegEx,
                                    // with {MARKER} being one of \d+[.] or [*+-], depending on list_type:

                                    /*
                                     list_str = list_str.replace(/
                                     (^[ \t]*)                       // leading whitespace = $1
                                     ({MARKER}) [ \t]+               // list marker = $2
                                     ([^\r]+?                        // list item text   = $3
                                     (\n+)
                                     )
                                     (?=
                                     (~0 | \2 ({MARKER}) [ \t]+)
                                     )
                                     /gm, function(){...});
                                     */

                                    //2015-10-22 wiz: 修改 list 的支持规则， 同级的 无序列表 和 有序列表 不会自动处理为 父子关系， 而是生成平级的两个列表；
                                    //var marker = _listItemMarkers[list_type];
                                    //var re = new RegExp("(^[ \\t]*)(" + marker + ")[ \\t]+([^\\r]+?(\\n+))(?=(~0|\\1(" + marker + ")[ \\t]+))", "gm");
                                    var re = new RegExp("(^[ \\t]*)([*+-]|\\d+[.])[ \\t]+([^\\r]+?(\\n+))(?=(~0|\\1([*+-]|\\d+[.])[ \\t]+))", "gm");
                                    var last_item_had_a_double_newline = false;
                                    list_str = list_str.replace(re, function (wholeMatch, m1, m2, m3) {
                                                var item = m3;
                                                var leading_space = m1;
                                                var cur_list_type = getListType(m2);
                                                var ends_with_double_newline = /\n\n$/.test(item);
                                                var contains_double_newline = ends_with_double_newline || item.search(/\n{2,}/) > -1;

                                                var loose = contains_double_newline || last_item_had_a_double_newline;
                                                item = _RunBlockGamut(_Outdent(item), /* doNotUnhash = */true, /* doNotCreateParagraphs = */!loose);

                                                var itemHtml = '';
                                                if (cur_list_type != list_type) {
                                                            itemHtml = '</' + list_type + '>\n<' + cur_list_type + '>\n';
                                                            list_type = cur_list_type;
                                                }
                                                itemHtml += "<li>" + item + "</li>\n";

                                                last_item_had_a_double_newline = ends_with_double_newline;
                                                return itemHtml;
                                    });

                                    // attacklab: strip sentinel
                                    list_str = list_str.replace(/~0/g, "");

                                    g_list_level--;
                                    return { list_str: list_str, list_type: list_type };
                        }

                        function _DoCodeBlocks(text) {
                                    //
                                    //  Process Markdown `<pre><code>` blocks.
                                    //

                                    /*
                                     text = text.replace(/
                                     (?:\n\n|^)
                                     (                               // $1 = the code block -- one or more lines, starting with a space/tab
                                     (?:
                                     (?:[ ]{4}|\t)           // Lines must start with a tab or a tab-width of spaces - attacklab: g_tab_width
                                     .*\n+
                                     )+
                                     )
                                     (\n*[ ]{0,3}[^ \t\n]|(?=~0))    // attacklab: g_tab_width
                                     /g ,function(){...});
                                     */

                                    // attacklab: sentinel workarounds for lack of \A and \Z, safari\khtml bug
                                    text += "~0";

                                    text = text.replace(/(?:\n\n|^\n?)((?:(?:[ ]{4}|\t).*\n+)+)(\n*[ ]{0,3}[^ \t\n]|(?=~0))/g, function (wholeMatch, m1, m2) {
                                                var codeblock = m1;
                                                var nextChar = m2;

                                                codeblock = _EncodeCode(_Outdent(codeblock));
                                                codeblock = _Detab(codeblock);
                                                codeblock = codeblock.replace(/^\n+/g, ""); // trim leading newlines
                                                codeblock = codeblock.replace(/\n+$/g, ""); // trim trailing whitespace

                                                codeblock = "<pre><code>" + codeblock + "\n</code></pre>";

                                                return "\n\n" + codeblock + "\n\n" + nextChar;
                                    });

                                    // attacklab: strip sentinel
                                    text = text.replace(/~0/, "");

                                    return text;
                        }

                        function _DoCodeSpans(text) {
                                    //
                                    // * Backtick quotes are used for <code></code> spans.
                                    //
                                    // * You can use multiple backticks as the delimiters if you want to
                                    //   include literal backticks in the code span. So, this input:
                                    //
                                    //      Just type ``foo `bar` baz`` at the prompt.
                                    //
                                    //   Will translate to:
                                    //
                                    //      <p>Just type <code>foo `bar` baz</code> at the prompt.</p>
                                    //
                                    //   There's no arbitrary limit to the number of backticks you
                                    //   can use as delimters. If you need three consecutive backticks
                                    //   in your code, use four for delimiters, etc.
                                    //
                                    // * You can use spaces to get literal backticks at the edges:
                                    //
                                    //      ... type `` `bar` `` ...
                                    //
                                    //   Turns to:
                                    //
                                    //      ... type <code>`bar`</code> ...
                                    //

                                    /*
                                     text = text.replace(/
                                     (^|[^\\`])      // Character before opening ` can't be a backslash or backtick
                                     (`+)            // $2 = Opening run of `
                                     (?!`)           // and no more backticks -- match the full run
                                     (               // $3 = The code block
                                     [^\r]*?
                                     [^`]        // attacklab: work around lack of lookbehind
                                     )
                                     \2              // Matching closer
                                     (?!`)
                                     /gm, function(){...});
                                     */

                                    text = text.replace(/(^|[^\\`])(`+)(?!`)([^\r]*?[^`])\2(?!`)/gm, function (wholeMatch, m1, m2, m3, m4) {
                                                var c = m3;
                                                c = c.replace(/^([ \t]*)/g, ""); // leading whitespace
                                                c = c.replace(/[ \t]*$/g, ""); // trailing whitespace
                                                c = _EncodeCode(c);
                                                c = c.replace(/:\/\//g, "~P"); // to prevent auto-linking. Not necessary in code *blocks*, but in code spans. Will be converted back after the auto-linker runs.
                                                return m1 + "<code>" + c + "</code>";
                                    });

                                    return text;
                        }

                        function _EncodeCode(text) {
                                    //
                                    // Encode/escape certain characters inside Markdown code runs.
                                    // The point is that in code, these characters are literals,
                                    // and lose their special Markdown meanings.
                                    //
                                    // Encode all ampersands; HTML entities are not
                                    // entities within a Markdown code span.
                                    text = text.replace(/&/g, "&amp;");

                                    // Do the angle bracket song and dance:
                                    text = text.replace(/</g, "&lt;");
                                    text = text.replace(/>/g, "&gt;");

                                    // Now, escape characters that are magic in Markdown:
                                    text = escapeCharacters(text, "\*_{}[]\\", false);

                                    // jj the line above breaks this:
                                    //---

                                    //* Item

                                    //   1. Subitem

                                    //            special char: *
                                    //---

                                    return text;
                        }

                        function _DoItalicsAndBoldStrict(text) {

                                    if (text.indexOf("*") === -1 && text.indexOf("_") === -1) return text;

                                    text = asciify(text);

                                    // <strong> must go first:

                                    // (^|[\W_])           Start with a non-letter or beginning of string. Store in \1.
                                    // (?:(?!\1)|(?=^))    Either the next character is *not* the same as the previous,
                                    //                     or we started at the end of the string (in which case the previous
                                    //                     group had zero width, so we're still there). Because the next
                                    //                     character is the marker, this means that if there are e.g. multiple
                                    //                     underscores in a row, we can only match the left-most ones (which
                                    //                     prevents foo___bar__ from getting bolded)
                                    // (\*|_)              The marker character itself, asterisk or underscore. Store in \2.
                                    // \2                  The marker again, since bold needs two.
                                    // (?=\S)              The first bolded character cannot be a space.
                                    // ([^\r]*?\S)         The actual bolded string. At least one character, and it cannot *end*
                                    //                     with a space either. Note that like in many other places, [^\r] is
                                    //                     just a workaround for JS' lack of single-line regexes; it's equivalent
                                    //                     to a . in an /s regex, because the string cannot contain any \r (they
                                    //                     are removed in the normalizing step).
                                    // \2\2                The marker character, twice -- end of bold.
                                    // (?!\2)              Not followed by another marker character (ensuring that we match the
                                    //                     rightmost two in a longer row)...
                                    // (?=[\W_]|$)         ...but by any other non-word character or the end of string.
                                    text = text.replace(/(^|[\W_])(?:(?!\1)|(?=^))(\*|_)\2(?=\S)([^\r]*?\S)\2\2(?!\2)(?=[\W_]|$)/g, "$1<strong>$3</strong>");

                                    // This is almost identical to the <strong> regex, except 1) there's obviously just one marker
                                    // character, and 2) the italicized string cannot contain the marker character.
                                    text = text.replace(/(^|[\W_])(?:(?!\1)|(?=^))(\*|_)(?=\S)((?:(?!\2)[^\r])*?\S)\2(?!\2)(?=[\W_]|$)/g, "$1<em>$3</em>");

                                    return deasciify(text);
                        }

                        function _DoItalicsAndBold_AllowIntrawordWithAsterisk(text) {

                                    if (text.indexOf("*") === -1 && text.indexOf("_") === -1) return text;

                                    text = asciify(text);

                                    // <strong> must go first:
                                    // (?=[^\r][*_]|[*_])               Optimization only, to find potentially relevant text portions faster. Minimally slower in Chrome, but much faster in IE.
                                    // (                                Store in \1. This is the last character before the delimiter
                                    //     ^                            Either we're at the start of the string (i.e. there is no last character)...
                                    //     |                            ... or we allow one of the following:
                                    //     (?=                          (lookahead; we're not capturing this, just listing legal possibilities)
                                    //         \W__                     If the delimiter is __, then this last character must be non-word non-underscore (extra-word emphasis only)
                                    //         |
                                    //         (?!\*)[\W_]\*\*          If the delimiter is **, then this last character can be non-word non-asterisk (extra-word emphasis)...
                                    //         |
                                    //         \w\*\*\w                 ...or it can be word/underscore, but only if the first bolded character is such a character as well (intra-word emphasis)
                                    //     )
                                    //     [^\r]                        actually capture the character (can't use `.` since it could be \n)
                                    // )
                                    // (\*\*|__)                        Store in \2: the actual delimiter
                                    // (?!\2)                           not followed by the delimiter again (at most one more asterisk/underscore is allowed)
                                    // (?=\S)                           the first bolded character can't be a space
                                    // (                                Store in \3: the bolded string
                                    //
                                    //     (?:|                         Look at all bolded characters except for the last one. Either that's empty, meaning only a single character was bolded...
                                    //       [^\r]*?                    ... otherwise take arbitrary characters, minimally matching; that's all bolded characters except for the last *two*
                                    //       (?!\2)                       the last two characters cannot be the delimiter itself (because that would mean four underscores/asterisks in a row)
                                    //       [^\r]                        capture the next-to-last bolded character
                                    //     )
                                    //     (?=                          lookahead at the very last bolded char and what comes after
                                    //         \S_                      for underscore-bolding, it can be any non-space
                                    //         |
                                    //         \w                       for asterisk-bolding (otherwise the previous alternative would've matched, since \w implies \S), either the last char is word/underscore...
                                    //         |
                                    //         \S\*\*(?:[\W_]|$)        ... or it's any other non-space, but in that case the character *after* the delimiter may not be a word character
                                    //     )
                                    //     .                            actually capture the last character (can use `.` this time because the lookahead ensures \S in all cases)
                                    // )
                                    // (?=                              lookahead; list the legal possibilities for the closing delimiter and its following character
                                    //     __(?:\W|$)                   for underscore-bolding, the following character (if any) must be non-word non-underscore
                                    //     |
                                    //     \*\*(?:[^*]|$)               for asterisk-bolding, any non-asterisk is allowed (note we already ensured above that it's not a word character if the last bolded character wasn't one)
                                    // )
                                    // \2                               actually capture the closing delimiter (and make sure that it matches the opening one)

                                    //2015-10-26 改善对 xxx**(1)**xxx 的支持
                                    //text = text.replace(/(?=[^\r][*_]|[*_])(^|(?=\W__|(?!\*)[\W_]\*\*|\w\*\*\w)[^\r])(\*\*|__)(?!\2)(?=\S)((?:|[^\r]*?(?!\2)[^\r])(?=\S_|\w|\S\*\*(?:[\W_]|$)).)(?=__(?:\W|$)|\*\*(?:[^*]|$))\2/g,
                                    //    "$1<strong>$3</strong>");
                                    text = text.replace(/(?=[^\r][*_]|[*_])(^|(?=\W__|(?!\*)[\w\W_]\*\*|\w\*\*\w)[^\r])(\*\*|__)(?!\2)(?=\S)((?:|[^\r]*?(?!\2)[^\r])(?=\S_|\w|.\*\*(?:[\w\W_]|$)).)(?=__(?:\W|$)|\*\*(?:[^*]|$))\2/g, "$1<strong>$3</strong>");

                                    // now <em>:
                                    // (?=[^\r][*_]|[*_])               Optimization, see above.
                                    // (                                Store in \1. This is the last character before the delimiter
                                    //     ^                            Either we're at the start of the string (i.e. there is no last character)...
                                    //     |                            ... or we allow one of the following:
                                    //     (?=                          (lookahead; we're not capturing this, just listing legal possibilities)
                                    //         \W_                      If the delimiter is _, then this last character must be non-word non-underscore (extra-word emphasis only)
                                    //         |
                                    //         (?!\*)                   otherwise, we list two possiblities for * as the delimiter; in either case, the last characters cannot be an asterisk itself
                                    //         (?:
                                    //             [\W_]\*              this last character can be non-word (extra-word emphasis)...
                                    //             |
                                    //             \D\*(?=\w)\D         ...or it can be word (otherwise the first alternative would've matched), but only if
                                    //                                      a) the first italicized character is such a character as well (intra-word emphasis), and
                                    //                                      b) neither character on either side of the asterisk is a digit
                                    //         )
                                    //     )
                                    //     [^\r]                        actually capture the character (can't use `.` since it could be \n)
                                    // )
                                    // (\*|_)                           Store in \2: the actual delimiter
                                    // (?!\2\2\2)                       not followed by more than two more instances of the delimiter
                                    // (?=\S)                           the first italicized character can't be a space
                                    // (                                Store in \3: the italicized string
                                    //     (?:(?!\2)[^\r])*?            arbitrary characters except for the delimiter itself, minimally matching
                                    //     (?=                          lookahead at the very last italicized char and what comes after
                                    //         [^\s_]_                  for underscore-italicizing, it can be any non-space non-underscore
                                    //         |
                                    //         (?=\w)\D\*\D             for asterisk-italicizing, either the last char is word/underscore *and* neither character on either side of the asterisk is a digit...
                                    //         |
                                    //         [^\s*]\*(?:[\W_]|$)      ... or that last char is any other non-space non-asterisk, but then the character after the delimiter (if any) must be non-word
                                    //     )
                                    //     .                            actually capture the last character (can use `.` this time because the lookahead ensures \S in all cases)
                                    // )
                                    // (?=                              lookahead; list the legal possibilities for the closing delimiter and its following character
                                    //     _(?:\W|$)                    for underscore-italicizing, the following character (if any) must be non-word non-underscore
                                    //     |
                                    //     \*(?:[^*]|$)                 for asterisk-italicizing, any non-asterisk is allowed; all other restrictions have already been ensured in the previous lookahead
                                    // )
                                    // \2                               actually capture the closing delimiter (and make sure that it matches the opening one)

                                    //2015-10-26 改善对 xxx*(1)*xxx 的支持
                                    //text = text.replace(/(?=[^\r][*_]|[*_])(^|(?=\W_|(?!\*)(?:[\W_]\*|\D\*(?=\w)\D))[^\r])(\*|_)(?!\2\2\2)(?=\S)((?:(?!\2)[^\r])*?(?=[^\s_]_|(?=\w)\D\*\D|[^\s*]\*(?:[\W_]|$)).)(?=_(?:\W|$)|\*(?:[^*]|$))\2/g,
                                    //    "$1<em>$3</em>");
                                    text = text.replace(/(?=[^\r][*_]|[*_])(^|(?=\W_|(?!\*)(?:[\w\W_]\*|\D\*(?=\w)\D))[^\r])(\*|_)(?!\2\2\2)(?=\S)((?:(?!\2)[^\r])*?(?=[^\s_]_|(?=[\w\W])\D\*\D|[^\s*]\*(?:[\w\W_]|$)).)(?=_(?:\W|$)|\*(?:[^*]|$))\2/g, "$1<em>$3</em>");

                                    return deasciify(text);
                        }

                        function _DoBlockQuotes(text) {

                                    /*
                                     text = text.replace(/
                                     (                           // Wrap whole match in $1
                                     (
                                     ^[ \t]*>[ \t]?      // '>' at the start of a line
                                     .+\n                // rest of the first line
                                     (.+\n)*             // subsequent consecutive lines
                                     \n*                 // blanks
                                     )+
                                     )
                                     /gm, function(){...});
                                     */

                                    text = text.replace(/((^[ \t]*>[ \t]?.+\n(.+\n)*\n*)+)/gm, function (wholeMatch, m1) {
                                                var bq = m1;

                                                // attacklab: hack around Konqueror 3.5.4 bug:
                                                // "----------bug".replace(/^-/g,"") == "bug"

                                                bq = bq.replace(/^[ \t]*>[ \t]?/gm, "~0"); // trim one level of quoting

                                                // attacklab: clean up hack
                                                bq = bq.replace(/~0/g, "");

                                                bq = bq.replace(/^[ \t]+$/gm, ""); // trim whitespace-only lines
                                                bq = _RunBlockGamut(bq); // recurse

                                                bq = bq.replace(/(^|\n)/g, "$1  ");
                                                // These leading spaces screw with <pre> content, so we need to fix that:
                                                bq = bq.replace(/(\s*<pre>[^\r]+?<\/pre>)/gm, function (wholeMatch, m1) {
                                                            var pre = m1;
                                                            // attacklab: hack around Konqueror 3.5.4 bug:
                                                            pre = pre.replace(/^  /mg, "~0");
                                                            pre = pre.replace(/~0/g, "");
                                                            return pre;
                                                });

                                                return hashBlock("<blockquote>\n" + bq + "\n</blockquote>");
                                    });
                                    return text;
                        }

                        function _FormParagraphs(text, doNotUnhash, doNotCreateParagraphs) {
                                    //
                                    //  Params:
                                    //    $text - string to process with html <p> tags
                                    //

                                    // Strip leading and trailing lines:
                                    text = text.replace(/^\n+/g, "");
                                    text = text.replace(/\n+$/g, "");

                                    var grafs = text.split(/\n{2,}/g);
                                    var grafsOut = [];

                                    var markerRe = /~K(\d+)K/;

                                    //
                                    // Wrap <p> tags.
                                    //
                                    var end = grafs.length;
                                    for (var i = 0; i < end; i++) {
                                                var str = grafs[i];

                                                // if this is an HTML marker, copy it
                                                if (markerRe.test(str)) {
                                                            grafsOut.push(str);
                                                } else if (/\S/.test(str)) {
                                                            str = _RunSpanGamut(str);
                                                            str = str.replace(/^([ \t]*)/g, doNotCreateParagraphs ? "" : "<p>");
                                                            if (!doNotCreateParagraphs) str += "</p>";
                                                            grafsOut.push(str);
                                                }
                                    }
                                    //
                                    // Unhashify HTML blocks
                                    //
                                    if (!doNotUnhash) {
                                                end = grafsOut.length;
                                                for (var i = 0; i < end; i++) {
                                                            var foundAny = true;
                                                            while (foundAny) {
                                                                        // we may need several runs, since the data may be nested
                                                                        foundAny = false;
                                                                        grafsOut[i] = grafsOut[i].replace(/~K(\d+)K/g, function (wholeMatch, id) {
                                                                                    foundAny = true;
                                                                                    return g_html_blocks[id];
                                                                        });
                                                            }
                                                }
                                    }
                                    return grafsOut.join("\n\n");
                        }

                        function _EncodeAmpsAndAngles(text) {
                                    // Smart processing for ampersands and angle brackets that need to be encoded.

                                    // Ampersand-encoding based entirely on Nat Irons's Amputator MT plugin:
                                    //   http://bumppo.net/projects/amputator/
                                    text = text.replace(/&(?!#?[xX]?(?:[0-9a-fA-F]+|\w+);)/g, "&amp;");

                                    // Encode naked <'s
                                    text = text.replace(/<(?![a-z\/?!]|~D)/gi, "&lt;");

                                    return text;
                        }

                        function _EncodeBackslashEscapes(text) {
                                    //
                                    //   Parameter:  String.
                                    //   Returns:    The string, with after processing the following backslash
                                    //               escape sequences.
                                    //

                                    // attacklab: The polite way to do this is with the new
                                    // escapeCharacters() function:
                                    //
                                    //     text = escapeCharacters(text,"\\",true);
                                    //     text = escapeCharacters(text,"`*_{}[]()>#+-.!",true);
                                    //
                                    // ...but we're sidestepping its use of the (slow) RegExp constructor
                                    // as an optimization for Firefox.  This function gets called a LOT.

                                    text = text.replace(/\\(\\)/g, escapeCharacters_callback);
                                    text = text.replace(/\\([`*_{}\[\]()>#+-.!])/g, escapeCharacters_callback);
                                    return text;
                        }

                        var charInsideUrl = "[-A-Z0-9+&@#/%?=~_|[\\]()!:,.;]",
                            charEndingUrl = "[-A-Z0-9+&@#/%=~_|[\\])]",
                            autoLinkRegex = new RegExp("(=\"|<)?\\b(https?|ftp)(://" + charInsideUrl + "*" + charEndingUrl + ")(?=$|\\W)", "gi"),
                            endCharRegex = new RegExp(charEndingUrl, "i");

                        function handleTrailingParens(wholeMatch, lookbehind, protocol, link, index, str) {

                                    if (/^<[^<>]*(https?|ftp)/.test(str)) {
                                                //避免 html 标签内 属性值的 超链接被替换为 a 标签（例如 img 的src 属性）
                                                return wholeMatch;
                                    }
                                    if (lookbehind) return wholeMatch;
                                    if (link.charAt(link.length - 1) !== ")") return "<" + protocol + link + ">";
                                    var parens = link.match(/[()]/g);
                                    var level = 0;
                                    for (var i = 0; i < parens.length; i++) {
                                                if (parens[i] === "(") {
                                                            if (level <= 0) level = 1;else level++;
                                                } else {
                                                            level--;
                                                }
                                    }
                                    var tail = "";
                                    if (level < 0) {
                                                var re = new RegExp("\\){1," + -level + "}$");
                                                link = link.replace(re, function (trailingParens) {
                                                            tail = trailingParens;
                                                            return "";
                                                });
                                    }
                                    if (tail) {
                                                var lastChar = link.charAt(link.length - 1);
                                                if (!endCharRegex.test(lastChar)) {
                                                            tail = lastChar + tail;
                                                            link = link.substr(0, link.length - 1);
                                                }
                                    }
                                    return "<" + protocol + link + ">" + tail;
                        }

                        function _DoAutoLinks(text) {

                                    // note that at this point, all other URL in the text are already hyperlinked as <a href=""></a>
                                    // *except* for the <http://www.foo.com> case

                                    // automatically add < and > around unadorned raw hyperlinks
                                    // must be preceded by a non-word character (and not by =" or <) and followed by non-word/EOF character
                                    // simulating the lookbehind in a consuming way is okay here, since a URL can neither and with a " nor
                                    // with a <, so there is no risk of overlapping matches.
                                    text = text.replace(autoLinkRegex, handleTrailingParens);

                                    //  autolink anything like <http://example.com>

                                    var replacer = function replacer(wholematch, m1) {
                                                var url = attributeSafeUrl(m1);

                                                return "<a href=\"" + url + "\">" + pluginHooks.plainLinkText(m1) + "</a>";
                                    };
                                    text = text.replace(/<((https?|ftp):[^'">\s]+)>/gi, replacer);

                                    // Email addresses: <address@domain.foo>
                                    /*
                                     text = text.replace(/
                                     <
                                     (?:mailto:)?
                                     (
                                     [-.\w]+
                                     \@
                                     [-a-z0-9]+(\.[-a-z0-9]+)*\.[a-z]+
                                     )
                                     >
                                     /gi, _DoAutoLinks_callback());
                                     */

                                    /* disabling email autolinking, since we don't do that on the server, either
                                     text = text.replace(/<(?:mailto:)?([-.\w]+\@[-a-z0-9]+(\.[-a-z0-9]+)*\.[a-z]+)>/gi,
                                     function(wholeMatch,m1) {
                                     return _EncodeEmailAddress( _UnescapeSpecialChars(m1) );
                                     }
                                     );
                                     */
                                    return text;
                        }

                        function _UnescapeSpecialChars(text) {
                                    //
                                    // Swap back in all the special characters we've hidden.
                                    //
                                    text = text.replace(/~E(\d+)E/g, function (wholeMatch, m1) {
                                                var charCodeToReplace = parseInt(m1);
                                                return String.fromCharCode(charCodeToReplace);
                                    });
                                    return text;
                        }

                        function _Outdent(text) {
                                    //
                                    // Remove one level of line-leading tabs or spaces
                                    //

                                    // attacklab: hack around Konqueror 3.5.4 bug:
                                    // "----------bug".replace(/^-/g,"") == "bug"

                                    text = text.replace(/^(\t|[ ]{1,4})/gm, "~0"); // attacklab: g_tab_width

                                    // attacklab: clean up hack
                                    text = text.replace(/~0/g, "");

                                    return text;
                        }

                        function _Detab(text) {
                                    if (!/\t/.test(text)) return text;

                                    var spaces = ["    ", "   ", "  ", " "],
                                        skew = 0,
                                        v;

                                    return text.replace(/[\n\t]/g, function (match, offset) {
                                                if (match === "\n") {
                                                            skew = offset + 1;
                                                            return match;
                                                }
                                                v = (offset - skew) % 4;
                                                skew = offset + 1;
                                                return spaces[v];
                                    });
                        }

                        //
                        //  attacklab: Utility functions
                        //

                        function attributeSafeUrl(url) {
                                    url = attributeEncode(url);
                                    url = escapeCharacters(url, "*_:()[]");
                                    return url;
                        }

                        function escapeCharacters(text, charsToEscape, afterBackslash) {
                                    // First we have to escape the escape characters so that
                                    // we can build a character class out of them
                                    var regexString = "([" + charsToEscape.replace(/([\[\]\\])/g, "\\$1") + "])";

                                    if (afterBackslash) {
                                                regexString = "\\\\" + regexString;
                                    }

                                    var regex = new RegExp(regexString, "g");
                                    text = text.replace(regex, escapeCharacters_callback);

                                    return text;
                        }

                        function escapeCharacters_callback(wholeMatch, m1) {
                                    var charCodeToEscape = m1.charCodeAt(0);
                                    return "~E" + charCodeToEscape + "E";
                        }
            }; // end of the Markdown.Converter constructor
})();

exports["default"] = Markdown;
module.exports = exports["default"];

},{}],32:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});
var Markdown = {};

(function () {
  // A quick way to make sure we're only keeping span-level tags when we need to.
  // This isn't supposed to be foolproof. It's just a quick way to make sure we
  // keep all span-level tags returned by a pagedown converter. It should allow
  // all span-level tags through, with or without attributes.
  var inlineTags = new RegExp(['^(<\\/?(a|abbr|acronym|applet|area|b|basefont|', 'bdo|big|button|cite|code|del|dfn|em|figcaption|', 'font|i|iframe|img|input|ins|kbd|label|map|', 'mark|meter|object|param|progress|q|ruby|rp|rt|s|', 'samp|script|select|small|span|strike|strong|', 'sub|sup|textarea|time|tt|u|var|wbr)[^>]*>|', '<(br)\\s?\\/?>)$'].join(''), 'i');

  /******************************************************************
   * Utility Functions                                              *
   *****************************************************************/

  // patch for ie7
  if (!Array.indexOf) {
    Array.prototype.indexOf = function (obj) {
      for (var i = 0; i < this.length; i++) {
        if (this[i] == obj) {
          return i;
        }
      }
      return -1;
    };
  }

  function trim(str) {
    return str.replace(/^\s+|\s+$/g, '');
  }

  function rtrim(str) {
    return str.replace(/\s+$/g, '');
  }

  // Remove one level of indentation from text. Indent is 4 spaces.
  function outdent(text) {
    return text.replace(new RegExp('^(\\t|[ ]{1,4})', 'gm'), '');
  }

  function contains(str, substr) {
    return str.indexOf(substr) != -1;
  }

  // Sanitize html, removing tags that aren't in the whitelist
  function sanitizeHtml(html, whitelist) {
    return html.replace(/<[^>]*>?/gi, function (tag) {
      return tag.match(whitelist) ? tag : '';
    });
  }

  // Merge two arrays, keeping only unique elements.
  function union(x, y) {
    var obj = {};
    for (var i = 0; i < x.length; i++) obj[x[i]] = x[i];
    for (i = 0; i < y.length; i++) obj[y[i]] = y[i];
    var res = [];
    for (var k in obj) {
      if (obj.hasOwnProperty(k)) res.push(obj[k]);
    }
    return res;
  }

  // JS regexes don't support \A or \Z, so we add sentinels, as Pagedown
  // does. In this case, we add the ascii codes for start of text (STX) and
  // end of text (ETX), an idea borrowed from:
  // https://github.com/tanakahisateru/js-markdown-extra
  function addAnchors(text) {
    if (text.charAt(0) != '\x02') text = '\x02' + text;
    if (text.charAt(text.length - 1) != '\x03') text = text + '\x03';
    return text;
  }

  // Remove STX and ETX sentinels.
  function removeAnchors(text) {
    if (text.charAt(0) == '\x02') text = text.substr(1);
    if (text.charAt(text.length - 1) == '\x03') text = text.substr(0, text.length - 1);
    return text;
  }

  // Convert markdown within an element, retaining only span-level tags
  function convertSpans(text, extra) {
    return sanitizeHtml(convertAll(text, extra), inlineTags);
  }

  // Convert internal markdown using the stock pagedown converter
  function convertAll(text, extra) {
    var result = extra.blockGamutHookCallback(text);
    // We need to perform these operations since we skip the steps in the converter
    result = unescapeSpecialChars(result);
    result = result.replace(/~D/g, "$$").replace(/~T/g, "~");
    result = extra.previousPostConversion(result);
    return result;
  }

  // Convert escaped special characters
  function processEscapesStep1(text) {
    // Markdown extra adds two escapable characters, `:` and `|`
    return text.replace(/\\\|/g, '~I').replace(/\\:/g, '~i');
  }

  function processEscapesStep2(text) {
    return text.replace(/~I/g, '|').replace(/~i/g, ':');
  }

  // Duplicated from PageDown converter
  function unescapeSpecialChars(text) {
    // Swap back in all the special characters we've hidden.
    text = text.replace(/~E(\d+)E/g, function (wholeMatch, m1) {
      var charCodeToReplace = parseInt(m1);
      return String.fromCharCode(charCodeToReplace);
    });
    return text;
  }

  function slugify(text) {
    return text.toLowerCase().replace(/\s+/g, '-') // Replace spaces with -
    .replace(/[^\w\-]+/g, '') // Remove all non-word chars
    .replace(/\-\-+/g, '-') // Replace multiple - with single -
    .replace(/^-+/, '') // Trim - from start of text
    .replace(/-+$/, ''); // Trim - from end of text
  }

  /*****************************************************************************
   * Markdown.Extra *
   ****************************************************************************/

  Markdown.Extra = function () {
    // For converting internal markdown (in tables for instance).
    // This is necessary since these methods are meant to be called as
    // preConversion hooks, and the Markdown converter passed to init()
    // won't convert any markdown contained in the html tags we return.
    this.converter = null;

    // Stores html blocks we generate in hooks so that
    // they're not destroyed if the user is using a sanitizing converter
    this.hashBlocks = [];

    // Stores footnotes
    this.footnotes = {};
    this.usedFootnotes = [];

    // Special attribute blocks for fenced code blocks and headers enabled.
    this.attributeBlocks = false;

    // Fenced code block options
    this.googleCodePrettify = false;
    this.highlightJs = false;

    // Table options
    this.tableClass = '';

    this.tabWidth = 4;
  };

  Markdown.Extra.init = function (converter, options) {
    // Each call to init creates a new instance of Markdown.Extra so it's
    // safe to have multiple converters, with different options, on a single page
    var extra = new Markdown.Extra();
    var postNormalizationTransformations = [];
    var preBlockGamutTransformations = [];
    var postSpanGamutTransformations = [];
    var postConversionTransformations = ["unHashExtraBlocks"];

    options = options || {};
    options.extensions = options.extensions || ["all"];
    if (contains(options.extensions, "all")) {
      options.extensions = ["tables", "fenced_code_gfm", "def_list", "attr_list", "footnotes", "smartypants", "strikethrough", "newlines"];
    }
    preBlockGamutTransformations.push("wrapHeaders");
    if (contains(options.extensions, "attr_list")) {
      postNormalizationTransformations.push("hashFcbAttributeBlocks");
      preBlockGamutTransformations.push("hashHeaderAttributeBlocks");
      postConversionTransformations.push("applyAttributeBlocks");
      extra.attributeBlocks = true;
    }
    if (contains(options.extensions, "fenced_code_gfm")) {
      // This step will convert fcb inside list items and blockquotes
      preBlockGamutTransformations.push("fencedCodeBlocks");
      // This extra step is to prevent html blocks hashing and link definition/footnotes stripping inside fcb
      postNormalizationTransformations.push("fencedCodeBlocks");
    }
    if (contains(options.extensions, "tables")) {
      preBlockGamutTransformations.push("tables");
    }
    if (contains(options.extensions, "def_list")) {
      preBlockGamutTransformations.push("definitionLists");
    }
    if (contains(options.extensions, "footnotes")) {
      postNormalizationTransformations.push("stripFootnoteDefinitions");
      preBlockGamutTransformations.push("doFootnotes");
      postConversionTransformations.push("printFootnotes");
    }
    if (contains(options.extensions, "smartypants")) {
      postConversionTransformations.push("runSmartyPants");
    }
    if (contains(options.extensions, "strikethrough")) {
      postSpanGamutTransformations.push("strikethrough");
    }
    if (contains(options.extensions, "newlines")) {
      postSpanGamutTransformations.push("newlines");
    }

    converter.hooks.chain("postNormalization", function (text) {
      return extra.doTransform(postNormalizationTransformations, text) + '\n';
    });

    converter.hooks.chain("preBlockGamut", function (text, blockGamutHookCallback) {
      // Keep a reference to the block gamut callback to run recursively
      extra.blockGamutHookCallback = blockGamutHookCallback;
      text = processEscapesStep1(text);
      text = extra.doTransform(preBlockGamutTransformations, text) + '\n';
      text = processEscapesStep2(text);
      return text;
    });

    converter.hooks.chain("postSpanGamut", function (text) {
      return extra.doTransform(postSpanGamutTransformations, text);
    });

    // Keep a reference to the hook chain running before doPostConversion to apply on hashed extra blocks
    extra.previousPostConversion = converter.hooks.postConversion;
    converter.hooks.chain("postConversion", function (text) {
      text = extra.doTransform(postConversionTransformations, text);
      // Clear state vars that may use unnecessary memory
      extra.hashBlocks = [];
      extra.footnotes = {};
      extra.usedFootnotes = [];
      return text;
    });

    if ("highlighter" in options) {
      extra.googleCodePrettify = options.highlighter === 'prettify';
      extra.highlightJs = options.highlighter === 'highlight';
    }

    if ("table_class" in options) {
      extra.tableClass = options.table_class;
    }

    extra.converter = converter;

    // Caller usually won't need this, but it's handy for testing.
    return extra;
  };

  // Do transformations
  Markdown.Extra.prototype.doTransform = function (transformations, text) {
    for (var i = 0; i < transformations.length; i++) text = this[transformations[i]](text);
    return text;
  };

  // Return a placeholder containing a key, which is the block's index in the
  // hashBlocks array. We wrap our output in a <p> tag here so Pagedown won't.
  Markdown.Extra.prototype.hashExtraBlock = function (block) {
    return '\n<p>~X' + (this.hashBlocks.push(block) - 1) + 'X</p>\n';
  };
  Markdown.Extra.prototype.hashExtraInline = function (block) {
    return '~X' + (this.hashBlocks.push(block) - 1) + 'X';
  };

  // Replace placeholder blocks in `text` with their corresponding
  // html blocks in the hashBlocks array.
  Markdown.Extra.prototype.unHashExtraBlocks = function (text) {
    var self = this;

    function recursiveUnHash() {
      var hasHash = false;
      text = text.replace(/(?:<p>)?~X(\d+)X(?:<\/p>)?/g, function (wholeMatch, m1) {
        hasHash = true;
        var key = parseInt(m1, 10);
        return self.hashBlocks[key];
      });
      if (hasHash === true) {
        recursiveUnHash();
      }
    }

    recursiveUnHash();
    return text;
  };

  // Wrap headers to make sure they won't be in def lists
  Markdown.Extra.prototype.wrapHeaders = function (text) {
    function wrap(text) {
      return '\n' + text + '\n';
    }

    text = text.replace(/^.+[ \t]*\n=+[ \t]*\n+/gm, wrap);
    text = text.replace(/^.+[ \t]*\n-+[ \t]*\n+/gm, wrap);
    text = text.replace(/^\#{1,6}[ \t]*.+?[ \t]*\#*\n+/gm, wrap);
    return text;
  };

  /******************************************************************
   * Attribute Blocks                                               *
   *****************************************************************/

  // TODO: use sentinels. Should we just add/remove them in doConversion?
  // TODO: better matches for id / class attributes
  var attrBlock = "\\{[ \\t]*((?:[#.][-_:a-zA-Z0-9]+[ \\t]*)+)\\}";
  var hdrAttributesA = new RegExp("^(#{1,6}.*#{0,6})[ \\t]+" + attrBlock + "[ \\t]*(?:\\n|0x03)", "gm");
  var hdrAttributesB = new RegExp("^(.*)[ \\t]+" + attrBlock + "[ \\t]*\\n" + "(?=[\\-|=]+\\s*(?:\\n|0x03))", "gm"); // underline lookahead
  var fcbAttributes = new RegExp("^(```[ \\t]*[^{\\s]*)[ \\t]+" + attrBlock + "[ \\t]*\\n" + "(?=([\\s\\S]*?)\\n```[ \\t]*(\\n|0x03))", "gm");

  // Extract headers attribute blocks, move them above the element they will be
  // applied to, and hash them for later.
  Markdown.Extra.prototype.hashHeaderAttributeBlocks = function (text) {

    var self = this;

    function attributeCallback(wholeMatch, pre, attr) {
      return '<p>~XX' + (self.hashBlocks.push(attr) - 1) + 'XX</p>\n' + pre + "\n";
    }

    text = text.replace(hdrAttributesA, attributeCallback); // ## headers
    text = text.replace(hdrAttributesB, attributeCallback); // underline headers
    return text;
  };

  // Extract FCB attribute blocks, move them above the element they will be
  // applied to, and hash them for later.
  Markdown.Extra.prototype.hashFcbAttributeBlocks = function (text) {
    // TODO: use sentinels. Should we just add/remove them in doConversion?
    // TODO: better matches for id / class attributes

    var self = this;

    function attributeCallback(wholeMatch, pre, attr) {
      return '<p>~XX' + (self.hashBlocks.push(attr) - 1) + 'XX</p>\n' + pre + "\n";
    }

    return text.replace(fcbAttributes, attributeCallback);
  };

  Markdown.Extra.prototype.applyAttributeBlocks = function (text) {
    var self = this;
    var blockRe = new RegExp('<p>~XX(\\d+)XX</p>[\\s]*' + '(?:<(h[1-6]|pre)(?: +class="(\\S+)")?(>[\\s\\S]*?</\\2>))', "gm");
    text = text.replace(blockRe, function (wholeMatch, k, tag, cls, rest) {
      if (!tag) // no following header or fenced code block.
        return '';

      // get attributes list from hash
      var key = parseInt(k, 10);
      var attributes = self.hashBlocks[key];

      // get id
      var id = attributes.match(/#[^\s#.]+/g) || [];
      var idStr = id[0] ? ' id="' + id[0].substr(1, id[0].length - 1) + '"' : '';

      // get classes and merge with existing classes
      var classes = attributes.match(/\.[^\s#.]+/g) || [];
      for (var i = 0; i < classes.length; i++) // Remove leading dot
      classes[i] = classes[i].substr(1, classes[i].length - 1);

      var classStr = '';
      if (cls) classes = union(classes, [cls]);

      if (classes.length > 0) classStr = ' class="' + classes.join(' ') + '"';

      return "<" + tag + idStr + classStr + rest;
    });

    return text;
  };

  /******************************************************************
   * Tables                                                         *
   *****************************************************************/

  // Find and convert Markdown Extra tables into html.
  Markdown.Extra.prototype.tables = function (text) {
    var self = this;

    var leadingPipe = new RegExp(['^', '[ ]{0,3}', // Allowed whitespace
    '[|]', // Initial pipe
    '(.+)\\n', // $1: Header Row

    '[ ]{0,3}', // Allowed whitespace
    '[|]([ ]*[-:]+[-| :]*)\\n', // $2: Separator

    '(', // $3: Table Body
    '(?:[ ]*[|].*\\n?)*', // Table rows
    ')', '(?:\\n|$)' // Stop at final newline
    ].join(''), 'gm');

    var noLeadingPipe = new RegExp(['^', '[ ]{0,3}', // Allowed whitespace
    '(\\S.*[|].*)\\n', // $1: Header Row

    '[ ]{0,3}', // Allowed whitespace
    '([-:]+[ ]*[|][-| :]*)\\n', // $2: Separator

    '(', // $3: Table Body
    '(?:.*[|].*\\n?)*', // Table rows
    ')', '(?:\\n|$)' // Stop at final newline
    ].join(''), 'gm');

    text = text.replace(leadingPipe, doTable);
    text = text.replace(noLeadingPipe, doTable);

    // $1 = header, $2 = separator, $3 = body
    function doTable(match, header, separator, body, offset, string) {
      // remove any leading pipes and whitespace
      header = header.replace(/^ *[|]/m, '');
      separator = separator.replace(/^ *[|]/m, '');
      body = body.replace(/^ *[|]/gm, '');

      // remove trailing pipes and whitespace
      header = header.replace(/[|] *$/m, '');
      separator = separator.replace(/[|] *$/m, '');
      body = body.replace(/[|] *$/gm, '');

      // determine column alignments
      var alignspecs = separator.split(/ *[|] */);
      var align = [];
      for (var i = 0; i < alignspecs.length; i++) {
        var spec = alignspecs[i];
        if (spec.match(/^ *-+: *$/m)) align[i] = ' align="right"';else if (spec.match(/^ *:-+: *$/m)) align[i] = ' align="center"';else if (spec.match(/^ *:-+ *$/m)) align[i] = ' align="left"';else align[i] = '';
      }

      // TODO: parse spans in header and rows before splitting, so that pipes
      // inside of tags are not interpreted as separators
      var headers = header.split(/ *[|] */);
      var colCount = headers.length;

      // build html
      var cls = self.tableClass ? ' class="' + self.tableClass + '"' : '';
      var html = ['<table', cls, '>\n', '<thead>\n', '<tr>\n'].join('');

      // build column headers.
      for (i = 0; i < colCount; i++) {
        var headerHtml = convertSpans(trim(headers[i]), self);
        html += ["  <th", align[i], ">", headerHtml, "</th>\n"].join('');
      }
      html += "</tr>\n</thead>\n";

      // build rows
      var rows = body.split('\n');
      for (i = 0; i < rows.length; i++) {
        if (rows[i].match(/^\s*$/)) // can apply to final row
          continue;

        // ensure number of rowCells matches colCount
        var rowCells = rows[i].split(/ *[|] */);
        var lenDiff = colCount - rowCells.length;
        for (var j = 0; j < lenDiff; j++) rowCells.push('');

        html += "<tr>\n";
        for (j = 0; j < colCount; j++) {
          var colHtml = convertSpans(trim(rowCells[j]), self);
          html += ["  <td", align[j], ">", colHtml, "</td>\n"].join('');
        }
        html += "</tr>\n";
      }

      html += "</table>\n";

      // replace html with placeholder until postConversion step
      return self.hashExtraBlock(html);
    }

    return text;
  };

  /******************************************************************
   * Footnotes                                                      *
   *****************************************************************/

  // Strip footnote, store in hashes.
  Markdown.Extra.prototype.stripFootnoteDefinitions = function (text) {
    var self = this;

    text = text.replace(/\n[ ]{0,3}\[\^(.+?)\]\:[ \t]*\n?([\s\S]*?)\n{1,2}((?=\n[ ]{0,3}\S)|$)/g, function (wholeMatch, m1, m2) {
      m1 = slugify(m1);
      m2 += "\n";
      m2 = m2.replace(/^[ ]{0,3}/g, "");
      self.footnotes[m1] = m2;
      return "\n";
    });

    return text;
  };

  // Find and convert footnotes references.
  Markdown.Extra.prototype.doFootnotes = function (text) {
    var self = this;
    if (self.isConvertingFootnote === true) {
      return text;
    }

    var footnoteCounter = 0;
    text = text.replace(/\[\^(.+?)\]/g, function (wholeMatch, m1) {
      var id = slugify(m1);
      var footnote = self.footnotes[id];
      if (footnote === undefined) {
        return wholeMatch;
      }
      footnoteCounter++;
      self.usedFootnotes.push(id);
      var html = '<a href="#fn_' + id + '" id="fnref_' + id + '" title="See footnote" class="footnote">' + footnoteCounter + '</a>';
      return self.hashExtraInline(html);
    });

    return text;
  };

  // Print footnotes at the end of the document
  Markdown.Extra.prototype.printFootnotes = function (text) {
    var self = this;

    if (self.usedFootnotes.length === 0) {
      return text;
    }

    text += '\n\n<div class="footnotes">\n<hr>\n<ol>\n\n';
    for (var i = 0; i < self.usedFootnotes.length; i++) {
      var id = self.usedFootnotes[i];
      var footnote = self.footnotes[id];
      self.isConvertingFootnote = true;
      var formattedfootnote = convertSpans(footnote, self);
      delete self.isConvertingFootnote;
      text += '<li id="fn_' + id + '">' + formattedfootnote + ' <a href="#fnref_' + id + '" title="Return to article" class="reversefootnote">&#8617;</a></li>\n\n';
    }
    text += '</ol>\n</div>';
    return text;
  };

  /******************************************************************
   * Fenced Code Blocks  (gfm)                                       *
   ******************************************************************/

  // Find and convert gfm-inspired fenced code blocks into html.
  Markdown.Extra.prototype.fencedCodeBlocks = function (text) {
    function encodeCode(code) {
      code = code.replace(/&/g, "&amp;");
      code = code.replace(/</g, "&lt;");
      code = code.replace(/>/g, "&gt;");
      // These were escaped by PageDown before postNormalization
      code = code.replace(/~D/g, "$$");
      code = code.replace(/~T/g, "~");
      return code;
    }

    var self = this;
    text = text.replace(/(?:^|\n)```[ \t]*(\S*)[ \t]*\n([\s\S]*?)\n```[ \t]*(?=\n)/g, function (match, m1, m2) {
      var language = m1,
          codeblock = m2;

      // adhere to specified options
      var preclass = self.googleCodePrettify ? ' class="prettyprint linenums"' : '';
      var codeclass = '';
      if (language) {
        if (self.googleCodePrettify || self.highlightJs) {
          // use html5 language- class names. supported by both prettify and highlight.js
          codeclass = ' class="language-' + language + '"';
        } else {
          codeclass = ' class="' + language + '"';
        }
      }

      var html = ['<pre', preclass, '><code', codeclass, '>', encodeCode(codeblock), '</code></pre>'].join('');

      // replace codeblock with placeholder until postConversion step
      return self.hashExtraBlock(html);
    });

    return text;
  };

  /******************************************************************
   * SmartyPants                                                     *
   ******************************************************************/

  Markdown.Extra.prototype.educatePants = function (text) {
    var self = this;
    var result = '';
    var blockOffset = 0;
    // Here we parse HTML in a very bad manner
    text.replace(/(?:<!--[\s\S]*?-->)|(<)([a-zA-Z1-6]+)([^\n]*?>)([\s\S]*?)(<\/\2>)/g, function (wholeMatch, m1, m2, m3, m4, m5, offset) {
      var token = text.substring(blockOffset, offset);
      result += self.applyPants(token);
      self.smartyPantsLastChar = result.substring(result.length - 1);
      blockOffset = offset + wholeMatch.length;
      if (!m1) {
        // Skip commentary
        result += wholeMatch;
        return;
      }
      // Skip special tags
      if (!/code|kbd|pre|script|noscript|iframe|math|ins|del|pre/i.test(m2)) {
        m4 = self.educatePants(m4);
      } else {
        self.smartyPantsLastChar = m4.substring(m4.length - 1);
      }
      result += m1 + m2 + m3 + m4 + m5;
    });
    var lastToken = text.substring(blockOffset);
    result += self.applyPants(lastToken);
    self.smartyPantsLastChar = result.substring(result.length - 1);
    return result;
  };

  function revertPants(wholeMatch, m1) {
    var blockText = m1;
    blockText = blockText.replace(/&\#8220;/g, "\"");
    blockText = blockText.replace(/&\#8221;/g, "\"");
    blockText = blockText.replace(/&\#8216;/g, "'");
    blockText = blockText.replace(/&\#8217;/g, "'");
    blockText = blockText.replace(/&\#8212;/g, "---");
    blockText = blockText.replace(/&\#8211;/g, "--");
    blockText = blockText.replace(/&\#8230;/g, "...");
    return blockText;
  }

  Markdown.Extra.prototype.applyPants = function (text) {
    // Dashes
    text = text.replace(/---/g, "&#8212;").replace(/--/g, "&#8211;");
    // Ellipses
    text = text.replace(/\.\.\./g, "&#8230;").replace(/\.\s\.\s\./g, "&#8230;");
    // Backticks
    // text = text.replace(/``/g, "&#8220;").replace(/''/g, "&#8221;");

    // if (/^'$/.test(text)) {
    //   // Special case: single-character ' token
    //   if (/\S/.test(this.smartyPantsLastChar)) {
    //     return "&#8217;";
    //   }
    //   return "&#8216;";
    // }
    // if (/^"$/.test(text)) {
    //   // Special case: single-character " token
    //   if (/\S/.test(this.smartyPantsLastChar)) {
    //     return "&#8221;";
    //   }
    //   return "&#8220;";
    // }

    // Special case if the very first character is a quote
    // followed by punctuation at a non-word-break. Close the quotes by brute force:
    // text = text.replace(/^'(?=[!"#\$\%'()*+,\-.\/:;<=>?\@\[\\]\^_`{|}~]\B)/, "&#8217;");
    // text = text.replace(/^"(?=[!"#\$\%'()*+,\-.\/:;<=>?\@\[\\]\^_`{|}~]\B)/, "&#8221;");

    // Special case for double sets of quotes, e.g.:
    //   <p>He said, "'Quoted' words in a larger quote."</p>
    // text = text.replace(/"'(?=\w)/g, "&#8220;&#8216;");
    // text = text.replace(/'"(?=\w)/g, "&#8216;&#8220;");

    // Special case for decade abbreviations (the '80s):
    // text = text.replace(/'(?=\d{2}s)/g, "&#8217;");

    // Get most opening single quotes:
    // text = text.replace(/(\s|&nbsp;|--|&[mn]dash;|&\#8211;|&\#8212;|&\#x201[34];)'(?=\w)/g, "$1&#8216;");

    // Single closing quotes:
    // text = text.replace(/([^\s\[\{\(\-])'/g, "$1&#8217;");
    // text = text.replace(/'(?=\s|s\b)/g, "&#8217;");

    // Any remaining single quotes should be opening ones:
    // text = text.replace(/'/g, "&#8216;");

    // Get most opening double quotes:
    // text = text.replace(/(\s|&nbsp;|--|&[mn]dash;|&\#8211;|&\#8212;|&\#x201[34];)"(?=\w)/g, "$1&#8220;");

    // Double closing quotes:
    // text = text.replace(/([^\s\[\{\(\-])"/g, "$1&#8221;");
    // text = text.replace(/"(?=\s)/g, "&#8221;");

    // Any remaining quotes should be opening ones.
    // text = text.replace(/"/ig, "&#8220;");
    return text;
  };

  // Find and convert markdown extra definition lists into html.
  Markdown.Extra.prototype.runSmartyPants = function (text) {
    this.smartyPantsLastChar = '';
    text = this.educatePants(text);
    // Clean everything inside html tags (some of them may have been converted due to our rough html parsing)
    text = text.replace(/(<([a-zA-Z1-6]+)\b([^\n>]*?)(\/)?>)/g, revertPants);
    return text;
  };

  /******************************************************************
   * Definition Lists                                                *
   ******************************************************************/

  // Find and convert markdown extra definition lists into html.
  Markdown.Extra.prototype.definitionLists = function (text) {
    var wholeList = new RegExp(['(\\x02\\n?|\\n\\n)', '(?:', '(', // $1 = whole list
    '(', // $2
    '[ ]{0,3}', '((?:[ \\t]*\\S.*\\n)+)', // $3 = defined term
    '\\n?', '[ ]{0,3}:[ ]+', // colon starting definition
    ')', '([\\s\\S]+?)', '(', // $4
    '(?=\\0x03)', // \z
    '|', '(?=', '\\n{2,}', '(?=\\S)', '(?!', // Negative lookahead for another term
    '[ ]{0,3}', '(?:\\S.*\\n)+?', // defined term
    '\\n?', '[ ]{0,3}:[ ]+', // colon starting definition
    ')', '(?!', // Negative lookahead for another definition
    '[ ]{0,3}:[ ]+', // colon starting definition
    ')', ')', ')', ')', ')'].join(''), 'gm');

    var self = this;
    text = addAnchors(text);

    text = text.replace(wholeList, function (match, pre, list) {
      var result = trim(self.processDefListItems(list));
      result = "<dl>\n" + result + "\n</dl>";
      return pre + self.hashExtraBlock(result) + "\n\n";
    });

    return removeAnchors(text);
  };

  // Process the contents of a single definition list, splitting it
  // into individual term and definition list items.
  Markdown.Extra.prototype.processDefListItems = function (listStr) {
    var self = this;

    var dt = new RegExp(['(\\x02\\n?|\\n\\n+)', // leading line
    '(', // definition terms = $1
    '[ ]{0,3}', // leading whitespace
    '(?![:][ ]|[ ])', // negative lookahead for a definition
    //   mark (colon) or more whitespace
    '(?:\\S.*\\n)+?', // actual term (not whitespace)
    ')', '(?=\\n?[ ]{0,3}:[ ])' // lookahead for following line feed
    ].join(''), //   with a definition mark
    'gm');

    var dd = new RegExp(['\\n(\\n+)?', // leading line = $1
    '(', // marker space = $2
    '[ ]{0,3}', // whitespace before colon
    '[:][ ]+', // definition mark (colon)
    ')', '([\\s\\S]+?)', // definition text = $3
    '(?=\\n*', // stop at next definition mark,
    '(?:', // next term or end of text
    '\\n[ ]{0,3}[:][ ]|', '<dt>|\\x03', // \z
    ')', ')'].join(''), 'gm');

    listStr = addAnchors(listStr);
    // trim trailing blank lines:
    listStr = listStr.replace(/\n{2,}(?=\\x03)/, "\n");

    // Process definition terms.
    listStr = listStr.replace(dt, function (match, pre, termsStr) {
      var terms = trim(termsStr).split("\n");
      var text = '';
      for (var i = 0; i < terms.length; i++) {
        var term = terms[i];
        // process spans inside dt
        term = convertSpans(trim(term), self);
        text += "\n<dt>" + term + "</dt>";
      }
      return text + "\n";
    });

    // Process actual definitions.
    listStr = listStr.replace(dd, function (match, leadingLine, markerSpace, def) {
      if (leadingLine || def.match(/\n{2,}/)) {
        // replace marker with the appropriate whitespace indentation
        def = Array(markerSpace.length + 1).join(' ') + def;
        // process markdown inside definition
        // TODO?: currently doesn't apply extensions
        def = outdent(def) + "\n\n";
        def = "\n" + convertAll(def, self) + "\n";
      } else {
        // convert span-level markdown inside definition
        def = rtrim(def);
        def = convertSpans(outdent(def), self);
      }

      return "\n<dd>" + def + "</dd>\n";
    });

    return removeAnchors(listStr);
  };

  /***********************************************************
   * Strikethrough                                            *
   ************************************************************/

  Markdown.Extra.prototype.strikethrough = function (text) {
    // Pretty much duplicated from _DoItalicsAndBold
    return text.replace(/([\W_]|^)~T~T(?=\S)([^\r]*?\S[\*_]*)~T~T([\W_]|$)/g, "$1<del>$2</del>$3");
  };

  /***********************************************************
   * New lines                                                *
   ************************************************************/

  Markdown.Extra.prototype.newlines = function (text) {
    // We have to ignore already converted newlines and line breaks in sub-list items
    return text.replace(/(<(?:br|\/li)>)?\n/g, function (wholeMatch, previousTag) {
      return previousTag ? wholeMatch : " <br>\n";
    });
  };
})();

exports['default'] = Markdown.Extra;
module.exports = exports['default'];

},{}],33:[function(require,module,exports){
/**
 * markdown & mathjax 渲染处理
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('./../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('./../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('./../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _commonXss = require('./../common/xss');

var _commonXss2 = _interopRequireDefault(_commonXss);

var _commonDependLoader = require('./../common/dependLoader');

var _commonDependLoader2 = _interopRequireDefault(_commonDependLoader);

var _commonScriptLoader = require('./../common/scriptLoader');

var _commonScriptLoader2 = _interopRequireDefault(_commonScriptLoader);

var _MarkdownConverter = require('./Markdown.Converter');

var _MarkdownConverter2 = _interopRequireDefault(_MarkdownConverter);

var _MarkdownExtra = require('./Markdown.Extra');

var _MarkdownExtra2 = _interopRequireDefault(_MarkdownExtra);

var isMathjax = false;
var WizToc = '#wizToc';

var defalutCB = {
    markdown: function markdown() {
        Render.Win.prettyPrint();
        Render.tocRender();
        Render.flowRender();
        Render.sequenceRender();
    },
    mathJax: function mathJax() {}
};

var MarkdownRender = {
    init: function init() {
        Render.Win = _commonEnv2['default'].win;
        Render.Document = _commonEnv2['default'].doc;
        Render.Dependency = _commonEnv2['default'].dependency;

        return MarkdownRender;
    },
    markdown: function markdown(callback) {
        if (callback) {
            Render.callback.markdown = Render.addCb(defalutCB.markdown, callback.markdown);
            Render.callback.mathJax = Render.addCb(defalutCB.mathJax, callback.mathJax);
        }

        _commonDependLoader2['default'].loadCss(Render.Document, Render.getDependencyFiles('css', 'markdown'));

        _commonDependLoader2['default'].loadJs(Render.Document, Render.getDependencyFiles('js', 'markdown'), function () {
            Render.markdownConvert({});
            if (isMathjax) {
                Render.mathJaxRender();
            }
        });
    },
    mathJax: function mathJax(callback) {
        if (callback) {
            Render.callback.mathJax = Render.addCb(defalutCB.mathJax, callback);
        }
        Render.mathJaxRender();
    }
};

var Render = {
    Utils: _commonUtils2['default'],
    Win: null,
    Document: null,
    Dependency: null,
    callback: {
        markdown: null,
        mathJax: null
    },
    getDependencyFiles: function getDependencyFiles(type, id) {
        var i, j, g, ii, jj, gg, group;
        var markdownFiles = [];
        for (i = 0, j = Render.Dependency[type][id].length; i < j; i++) {
            g = Render.Dependency[type][id][i];
            if (type == 'css') {
                markdownFiles.push(Render.Dependency.files[type][g]);
            } else {
                group = [];
                for (ii = 0, jj = g.length; ii < jj; ii++) {
                    gg = g[ii];
                    group.push(Render.Dependency.files[type][gg]);
                }
                markdownFiles.push(group);
            }
        }
        return markdownFiles;
    },
    addCb: function addCb(defaultCb, newCb) {
        if (newCb) {
            return function () {
                defaultCb.apply(this, arguments);
                newCb.apply(this, arguments);
            };
        } else {
            return defaultCb;
        }
    },
    cb: function cb(callback, params) {
        if (callback) {
            callback.apply(this, params ? params : []);
        }
    },
    getBodyTxt: function getBodyTxt(body) {
        var text = body.innerText;
        if (!text) {
            // FF自己解析innerText
            text = Render.Utils.getInnerText($body[0]);
        }
        // 替换unicode160的空格为unicode为32的空格，否则pagedown无法识别
        return text.replace(/\u00a0/g, " ");
    },
    markdownConvert: function markdownConvert(frame) {
        var start, end, last, blocks, math, braces;
        var SPLIT = /(\$\$?|\\(?:begin|end)\{[a-z]*\*?\}|\\[\\{}$]|[{}]|(?:\n\s*)+|@@\d+@@)/i;

        var $doc = $(Render.Document);
        var $body = frame.container ? frame.container : $doc.find('body');

        $body.addClass('markdown-body');
        var converter = new _MarkdownConverter2['default'].Converter({
            nonAsciiLetters: true,
            asteriskIntraWordEmphasis: true
        });
        _MarkdownExtra2['default'].init(converter, { extensions: "all", highlighter: "prettify" });

        var text;
        try {
            Render.Utils.markdownPreProcess($body[0]);
            text = Render.tocReady(Render.getBodyTxt($body[0]));

            // 判断是否含有mathjax语法
            var judgeMathjaxText = text.replace(/\n/g, '\\n').replace(/\r\n?/g, "\n").replace(/```(.*\n)+?```/gm, '');
            isMathjax = /(\$\$?)[^$\n]+\1/.test(judgeMathjaxText);

            if (isMathjax) {
                text = removeMath(text);
            }

            text = converter.makeHtml(text);
            if (isMathjax) {
                text = replaceMath(text);
            }
            text = Render.xssFilter(text);
            $body[0].innerHTML = text;
        } catch (e) {
            console.error(e);
        }
        try {
            Render.cb(Render.callback.markdown, [isMathjax]);
        } catch (e) {
            console.error(e);
        }

        function replaceMath(text) {
            text = text.replace(/@@(\d+)@@/g, function (match, n) {
                return math[n];
            });
            math = null;
            return text;
        }

        function processMath(i, j) {
            var block = blocks.slice(i, j + 1).join("").replace(/&/g, "&amp;") // use HTML entity for &
            .replace(/</g, "&lt;") // use HTML entity for <
            .replace(/>/g, "&gt;"); // use HTML entity for
            while (j > i) {
                blocks[j] = "";
                j--;
            }
            blocks[i] = "@@" + math.length + "@@";
            math.push(block);
            start = end = last = null;
        }

        function removeMath(text) {
            start = end = last = null; // for tracking math delimiters
            math = []; // stores math strings for latter

            blocks = text.replace(/\r\n?/g, "\n").split(SPLIT);
            for (var i = 1, m = blocks.length; i < m; i += 2) {
                var block = blocks[i];
                if (block.charAt(0) === "@") {

                    blocks[i] = "@@" + math.length + "@@";
                    math.push(block);
                } else if (start) {

                    if (block === end) {
                        if (braces) {
                            last = i;
                        } else {
                            processMath(start, i);
                        }
                    } else if (block.match(/\n.*\n/)) {
                        if (last) {
                            i = last;
                            processMath(start, i);
                        }
                        start = end = last = null;
                        braces = 0;
                    } else if (block === "{") {
                        braces++;
                    } else if (block === "}" && braces) {
                        braces--;
                    }
                } else {
                    //
                    // Look for math start delimiters and when
                    // found, set up the end delimiter.
                    //
                    if (block === "$$") {
                        start = i;
                        end = block;
                        braces = 0;
                    } else if (block.substr(1, 5) === "begin") {
                        start = i;
                        end = "\\end" + block.substr(6);
                        braces = 0;
                    }
                }
            }
            if (last) {
                processMath(start, last);
            }
            return blocks.join("");
        }
    },
    tocReady: function tocReady(markdownStr) {
        return markdownStr.replace(/(^[ ]*)\[toc\]([ ]*(\n|$))/igm, '$1[](' + WizToc + ')$2');
    },
    tocRender: function tocRender() {
        var tocHtml = [],
            min = 6;
        $('h1,h2,h3,h4,h5,h6', Render.Document.body).each(function (index, item) {
            var n = parseInt(item.tagName.charAt(1));
            if (n < min) {
                min = n;
            }
        });

        $('h1,h2,h3,h4,h5,h6', Render.Document.body).each(function (index, item) {
            var id = 'wiz_toc_' + index;
            var n = parseInt(item.tagName.charAt(1));
            var $item = $(item);
            $item.attr('id', id);
            tocHtml.push('<a class="wiz_toc ' + 'h' + (n - min + 1) + '" href="#' + id + '">' + $item.text() + '</a>');
        });
        tocHtml = '<div class="wiz_toc_layer">' + tocHtml.join('<br/>') + '</div>';

        $('a', Render.Document.body).each(function (index, item) {
            item = $(item);
            if (item.attr('href') == WizToc) {
                item.before(tocHtml);
            }
        });
    },
    flowRender: function flowRender() {
        var f = $('.language-flow', Render.Document.body).parents('pre');
        f.each(function (fIndex, fObj) {
            var id = 'wiz-flow-' + fIndex;
            var line = $('li', fObj);
            var flowStr = '';
            line.each(function (index, obj) {
                var s = $(obj).text();
                if (s.length > 0) {
                    flowStr += s + '\n';
                }
            });
            if (flowStr.length > 0) {
                try {
                    fObj.style.display = 'none';
                    var diagram = Render.Win.flowchart.parse(flowStr);
                    var flowLayer = Render.Document.createElement('div');
                    flowLayer.id = id;
                    fObj.parentNode.insertBefore(flowLayer, fObj);
                    diagram.drawSVG(id);

                    //修正 svg 保证手机端自动适应大小
                    if (_commonEnv2['default'].client.isPhone) {
                        //pc、mac 客户端 取消height 设置后， 会导致height 变为0，从而不显示
                        var s = $('svg', flowLayer);
                        if (s.attr('width')) {
                            s.css({
                                'max-width': s.attr('width')
                            }).attr({
                                'height': null,
                                'width': '95%'
                            });
                        }
                    }
                } catch (e) {
                    console.error(e);
                }
            }
        });
    },
    sequenceRender: function sequenceRender() {
        var f = $('.language-sequence', Render.Document.body).parents('pre');
        f.each(function (fIndex, fObj) {
            var id = 'wiz-sequence-' + fIndex;
            var line = $('li', fObj);
            var seqStr = '';
            line.each(function (index, obj) {
                var s = $(obj).text();
                if (s.length > 0) {
                    seqStr += s + '\n';
                }
            });
            if (seqStr.length > 0) {
                try {
                    fObj.style.display = 'none';
                    var diagram = Render.Win.Diagram.parse(seqStr);
                    var seqLayer = Render.Document.createElement('div');
                    seqLayer.id = id;
                    fObj.parentNode.insertBefore(seqLayer, fObj);
                    diagram.drawSVG(id, { theme: 'simple' });

                    //修正 svg 保证手机端自动适应大小
                    if (_commonEnv2['default'].client.isPhone) {
                        //pc、mac 客户端 取消height 设置后， 会导致height 变为0，从而不显示
                        var s = $('svg', seqLayer);
                        if (s.attr('width')) {
                            s.get(0).setAttribute('viewBox', '0 0 ' + s.attr('width') + ' ' + s.attr('height'));
                            s.css({
                                'max-width': s.attr('width')
                            }).attr({
                                'preserveAspectRatio': 'xMidYMid meet',
                                'height': null,
                                'width': '95%'
                            });
                        }
                    }
                } catch (e) {
                    console.error(e);
                }
            }
        });
    },
    mathJaxRender: function mathJaxRender() {
        var config = 'MathJax.Hub.Config({\
                            skipStartupTypeset: true,\
                            "HTML-CSS": {\
                                preferredFont: "TeX",\
                                availableFonts: [\
                                    "STIX",\
                                    "TeX"\
                                ],\
                                linebreaks: {\
                                    automatic: true\
                                },\
                                EqnChunk: 10,\
                                imageFont: null\
                            },\
                            tex2jax: {\
                                inlineMath: [["$","$"],["\\\\\\\\(","\\\\\\\\)"]],\
                                displayMath: [["$$","$$"],["\\\\[","\\\\]"]],\
                                processEscapes: true },\
                            TeX: {\
                                equationNumbers: {\
                                    autoNumber: "AMS"\
                                },\
                                noUndefined: {\
                                    attributes: {\
                                        mathcolor: "red",\
                                        mathbackground: "#FFEEEE",\
                                        mathsize: "90%"\
                                    }\
                                },\
                                Safe: {\
                                    allow: {\
                                        URLs: "safe",\
                                        classes: "safe",\
                                        cssIDs: "safe",\
                                        styles: "safe",\
                                        fontsize: "all"\
                                    }\
                                }\
                            },\
                            messageStyle: "none"\
                        });';

        _commonScriptLoader2['default'].appendJsCode(Render.Document, 'MathJax = null', 'text/javascript');
        _commonScriptLoader2['default'].appendJsCode(Render.Document, config, 'text/x-mathjax-config');
        _commonDependLoader2['default'].loadJs(Render.Document, Render.getDependencyFiles('js', 'mathJax'), _render);

        function _render() {
            Render.Win._wizMathJaxCallback = function () {
                Render.cb(Render.callback.mathJax);
            };
            var runMath = 'MathJax.Hub.Queue(' + '["Typeset", MathJax.Hub, document.body, _wizMathJaxCallback]);';
            _commonScriptLoader2['default'].appendJsCode(Render.Document, runMath, 'text/javascript');
        }
    },
    xssFilter: (function () {
        if (typeof _commonXss2['default'] == 'undefined') {
            return null;
        }
        var xss = new _commonXss2['default'].FilterXSS({
            onIgnoreTag: function onIgnoreTag(tag, html, options) {
                //针对白名单之外的 tag 处理
                if (/script/ig.test(tag)) {
                    return _commonXss2['default'].escapeAttrValue(html);
                }
                if (options.isClosing) {
                    return '</' + tag + '>';
                }

                var x = _commonXss2['default'].parseAttr(html, function (name, value) {
                    value = _commonXss2['default'].safeAttrValue(tag, name, value, xss);
                    if (/^on/i.test(name)) {
                        return '';
                    } else if (value) {
                        return name + '="' + value + '"';
                    } else {
                        return name;
                    }
                });

                if (/^<!/i.test(html)) {
                    //<!doctype html>
                    x = '<!' + x;
                } else {
                    x = '<' + x;
                }

                if (html[html.length - 2] === '/') {
                    x += '/';
                }
                x += '>';
                return x;
            },
            onIgnoreTagAttr: function onIgnoreTagAttr(tag, name, value, isWhiteAttr) {
                if (!!value && /^(id|class|style|data|width|height)/i.test(name)) {
                    return name + '="' + value + '"';
                }
                return '';
            },
            safeAttrValue: function safeAttrValue(tag, name, value) {
                // 自定义过滤属性值函数，如果为a标签的href属性，则先判断是否以wiz://开头
                if (tag === 'a' && name === 'href') {
                    if (/^((file|wiz(note)?):\/\/)/.test(value) || /^(#|index_files\/)/.test(value)) {
                        return _commonXss2['default'].escapeAttrValue(value);
                    }
                } else if (name === 'src') {
                    if (/^(file:\/\/)/.test(value) || /^(index_files\/|[\.]*\/)/.test(value)) {
                        return _commonXss2['default'].escapeAttrValue(value);
                    } else if (!/^(http[s]?|ftp|):\/\//.test(value)) {
                        return './' + _commonXss2['default'].escapeAttrValue(value);
                    }
                }
                // 其他情况，使用默认的safeAttrValue处理函数
                return _commonXss2['default'].safeAttrValue(tag, name, value);
            }
        });
        return function (html) {
            return xss.process(html);
        };
    })()
};
exports['default'] = MarkdownRender;
module.exports = exports['default'];

},{"./../common/const":13,"./../common/dependLoader":14,"./../common/env":15,"./../common/scriptLoader":18,"./../common/utils":19,"./../common/xss":22,"./Markdown.Converter":31,"./Markdown.Extra":32}],34:[function(require,module,exports){
/**
 * 夜间模式的基本方法集合
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonWizStyle = require('../common/wizStyle');

var _commonWizStyle2 = _interopRequireDefault(_commonWizStyle);

var _color = '#7990b6',
    _bk_color = '#1f2126',
    _brightness = '50%',
    _style_id = 'wiz_night_mode_style';

var nightModeUtils = {
    on: function on(color, bgColor, brightness) {
        if (color) {
            _color = color;
        }
        if (bgColor) {
            _bk_color = bgColor;
        }
        if (brightness) {
            _brightness = brightness;
        }

        nightModeUtils.off();

        var map = {},
            arr = [];

        checkElement('', _commonEnv2['default'].doc.body, map);

        var baseStyle = '{' + 'color:' + _color + ' !important; ' + 'background-color:' + _bk_color + ' !important; ' + 'background-image: none !important; ' + 'box-shadow: none !important; ' + 'border-color:' + _color + ' !important; ' + '}';

        for (var key in map) {
            if (map.hasOwnProperty(key)) {
                arr.push(key);
            }
        }

        var cssText = arr.join(", ");
        cssText += baseStyle;
        //image brightness
        cssText += 'img{filter: brightness(' + _brightness + ');-webkit-filter: brightness(' + _brightness + ');}';

        _commonWizStyle2['default'].insertStyle({
            id: _style_id,
            name: _commonConst2['default'].NAME.TMP_STYLE
        }, cssText);
    },
    off: function off() {
        var style = _commonEnv2['default'].doc.getElementById(_style_id);
        if (style) {
            style.remove();
        }
    }
};

function checkElement(pId, e, map) {
    addItemAttrToMap(pId, e, map);
    var elements = e.children;
    for (var i = 0; i < elements.length; i++) {
        var child = elements[i];
        checkElement(e.id ? e.id : pId, child, map);
    }
}

function addItemAttrToMap(pId, e, map) {
    if (!e) return;
    var tagName = e.tagName;

    if (/^(style|script|link|meta|img)$/ig.test(tagName)) {
        return;
    }

    var className = e.className;
    if (className && className.length > 0) {
        var arr = className.split(" ");
        for (var i = 0; i < arr.length; i++) {
            var name = arr[i];
            if (name.length == 0) {
                continue;
            }
            //if (!!pId) {
            //    addKeyToMap('#' + pId + " ." + name, map);
            //} else {
            addKeyToMap("." + name, map);
            //}
        }
    }
    var id = e.id;
    if (id && id.length > 0) {
        addKeyToMap("#" + id, map);
    }
    //某些页面的控件给自己的特殊样式添加 !important，这些控件一般会在顶层 dom 设置 id ，所以都加上 id
    //为了减少 样式冗余，目前只给 tag 添加 id ， className 暂时不添加
    if (!!pId) {
        addKeyToMap('#' + pId + " " + tagName, map);
    } else {
        addKeyToMap(tagName, map);
    }
}

function addKeyToMap(key, map) {
    //只保留 非数字开头的 且 全部内容为 数字、英文字母、. - _ 的 key
    if (!map[key] && !/^(\.|#)?[\d]+/i.test(key) && /^(\.|#)?[\. \w-]+$/i.test(key)) {
        map[key] = "";
    }
}

exports['default'] = nightModeUtils;
module.exports = exports['default'];

},{"../common/const":13,"../common/env":15,"../common/wizStyle":20}],35:[function(require,module,exports){
/**
 * 范围操作的基本方法集合
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('./../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('./../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('./../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _domUtilsDomBase = require('./../domUtils/domBase');

var _domUtilsDomBase2 = _interopRequireDefault(_domUtilsDomBase);

//通用方法集合
var rangeUtils = {
    /**
     * 设置 光标到可视范围内（移动滚动条）
     */
    caretFocus: function caretFocus() {
        //getClientRects 方法 在 ios 的 safari 上 还有问题
        var range = rangeUtils.getRange(),
            rectList = range ? range.getClientRects() : null,
            rect = rectList && rectList.length > 0 ? rectList[0] : null,
            cH = _commonEnv2['default'].doc.documentElement.clientHeight,
            cW = _commonEnv2['default'].doc.documentElement.clientWidth;

        if (rect && rect.top < 0) {
            _commonEnv2['default'].doc.body.scrollTop += rect.top;
        } else if (rect && rect.top + rect.height > cH) {
            _commonEnv2['default'].doc.body.scrollTop += rect.top + rect.height - cH;
        }

        if (rect && rect.left < 0) {
            _commonEnv2['default'].doc.body.scrollLeft += rect.left;
        } else if (rect && rect.left + rect.width > cW) {
            _commonEnv2['default'].doc.body.scrollLeft += rect.left + rect.width - cW;
        }
    },
    getRange: function getRange() {
        var sel = _commonEnv2['default'].doc.getSelection();
        return sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    },
    /**
     * 获取当前光标所在位置的dom元素
     * isCollapse = true 时 获取光标后面的第一个dom，如果当前在 textNode 内， 则直接返回 textNode
     * isCollapse = false， isBackward = false 获取 光标区间第一个 dom
     * isCollapse = false， isBackward = true 获取 光标区间最后一个 dom
     * @param isBackward
     * @returns {*}
     */
    getRangeAnchor: function getRangeAnchor(isBackward) {
        var range = rangeUtils.getRange();
        if (!range) {
            return null;
        }
        var rangeContainer = isBackward ? range.startContainer : range.endContainer,
            rangeOffset = isBackward ? range.startOffset : range.endOffset;

        if (!range.collapsed && !isBackward) {
            if (rangeContainer.nodeType === 3 && rangeOffset > 0) {
                return rangeContainer;
            } else if (rangeContainer.nodeType === 3) {
                return _domUtilsDomBase2['default'].getPreviousNode(rangeContainer, false, null);
            }

            if (rangeOffset > 0) {
                return _domUtilsDomBase2['default'].getLastDeepChild(rangeContainer.childNodes[rangeOffset - 1]);
            } else {
                return _domUtilsDomBase2['default'].getPreviousNode(rangeContainer, false, null);
            }
        }

        if (rangeContainer.nodeType === 3 && rangeOffset < rangeContainer.nodeValue.length) {
            return rangeContainer;
        } else if (rangeContainer.nodeType === 3) {
            return _domUtilsDomBase2['default'].getNextNode(rangeContainer, false, null);
        }

        if (rangeContainer.childNodes.length === 0) {
            return rangeContainer;
        } else if (rangeOffset == rangeContainer.childNodes.length) {
            return _domUtilsDomBase2['default'].getNextNode(rangeContainer.childNodes[rangeOffset - 1], false, null);
        } else {
            return _domUtilsDomBase2['default'].getFirstDeepChild(rangeContainer.childNodes[rangeOffset]);
        }
    },
    /**
     * 根据 获取 光标选中范围内的 dom 集合
     * @param options {noSplit: Boolean}
     * @returns {*}
     */
    getRangeDomList: function getRangeDomList(options) {
        var range = rangeUtils.getRange();
        if (!range) {
            return null;
        }
        var startDom = range.startContainer,
            startOffset = range.startOffset,
            endDom = range.endContainer,
            endOffset = range.endOffset;
        return _domUtilsDomBase2['default'].getDomListA2B({
            startDom: startDom,
            startOffset: startOffset,
            endDom: endDom,
            endOffset: endOffset,
            noSplit: !!options.noSplit
        });
    },
    /**
     * 获取 光标范围内 Dom 共同的父节点
     * @returns {*}
     */
    getRangeParentRoot: function getRangeParentRoot() {
        var range = rangeUtils.getRange(),
            startDom,
            endDom;
        if (!range) {
            return null;
        }
        startDom = range.startContainer;
        endDom = range.endContainer;
        return _domUtilsDomBase2['default'].getParentRoot([startDom, endDom]);
    },
    /**
     * 检验 dom 是否为 selection 的 边缘
     * @param dom
     */
    isRangeEdge: function isRangeEdge(dom) {
        var result = {
            isStart: false,
            isEnd: false
        };

        var range = rangeUtils.getRange();
        if (!range) {
            return;
        }
        result.isCollapsed = range.collapsed;
        result.startDom = range.startContainer;
        result.startOffset = range.startOffset;
        result.endDom = range.endContainer;
        result.endOffset = range.endOffset;

        var tmpStartDom, tmpEndDom;
        if (result.startDom.nodeType == 1 && result.startOffset < result.startDom.childNodes.length) {
            tmpStartDom = _domUtilsDomBase2['default'].getFirstDeepChild(result.startDom.childNodes[result.startOffset]);
        } else if (result.startDom.nodeType == 1) {
            tmpStartDom = _domUtilsDomBase2['default'].getNextNode(result.startDom.childNodes[result.startOffset - 1], false, null);
        }
        if (result.endDom.nodeType == 1 && result.endOffset > 0) {
            tmpEndDom = _domUtilsDomBase2['default'].getLastDeepChild(result.endDom.childNodes[result.endOffset - 1]);
        } else if (result.endDom.nodeType == 1) {
            tmpEndDom = _domUtilsDomBase2['default'].getPreviousNode(result.endDom, false, null);
        }
        result.isStart = result.startDom == dom || result.startDom == tmpStartDom;

        result.isEnd = result.endDom == dom || result.endDom == tmpEndDom;

        return result;
    },
    /**
     * 选中指定的 dom 元素
     * @param el
     */
    selectElementContents: function selectElementContents(el) {
        var range = _commonEnv2['default'].doc.createRange();
        range.selectNodeContents(el);
        var sel = _commonEnv2['default'].doc.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    },
    /**
     * 在光标位置选中单个字符，遇到 Fill-Char 特殊字符需要一直选取
     * @param isBackward
     */
    selectCharIncludeFillChar: function selectCharIncludeFillChar(isBackward) {
        var sel = _commonEnv2['default'].doc.getSelection(),
            range = sel.getRangeAt(0),
            direction = isBackward ? 'backward' : 'forward';

        var tmpCurDom, tmpOffset, tmpNextDom, s;
        if (range.startContainer.nodeType === 1) {
            tmpCurDom = rangeUtils.getRangeAnchor(false);
            //range.startContainer !== tmpCurDom 的时候， 往往不是在空行的最前面，而是在 前一个 dom 的最后面
            if (range.startContainer == tmpCurDom && _domUtilsDomBase2['default'].isTag(tmpCurDom, 'br') && _domUtilsDomBase2['default'].isEmptyDom(tmpCurDom.parentNode)) {
                if (tmpCurDom.parentNode.nextSibling) {
                    rangeUtils.setRange(tmpCurDom.parentNode, 0, tmpCurDom.parentNode.nextSibling, 0);
                } else {
                    sel.modify('move', 'forward', 'character');
                    sel.modify('extend', 'backward', 'character');
                    if (tmpCurDom.nextSibling) {
                        sel.modify('extend', 'backward', 'character');
                    }
                }
                return;
            } else if (_domUtilsDomBase2['default'].isTag(tmpCurDom, 'br')) {
                sel.modify('extend', direction, 'character');
            }
        }

        sel.modify('extend', direction, 'character');
        range = sel.getRangeAt(0);
        s = range.toString();
        tmpCurDom = rangeUtils.getRangeAnchor(isBackward);

        if (!tmpCurDom) {
            //当没有文字，且只剩下空标签 和 自闭合标签时，有时候会不存在 tmpCurDom
            return;
        }
        if (isBackward && tmpCurDom == range.startContainer) {
            tmpOffset = range.startOffset;
        } else if (!isBackward && tmpCurDom == range.endContainer) {
            tmpOffset = range.endOffset;
        } else {
            //只要 tmpCurDom 不是range 的原始 dom ，就直接设置 tmpOffset 为 -1
            tmpOffset = -1;
        }

        //如果光标在某个 textNode 中间， 则前后都是当前这个 textNode
        if (tmpCurDom.nodeType === 3 && tmpOffset > 0 && tmpOffset < tmpCurDom.nodeValue.length) {
            tmpNextDom = tmpCurDom;
        } else {
            tmpNextDom = isBackward ? _domUtilsDomBase2['default'].getPreviousNode(tmpCurDom, false, null) : _domUtilsDomBase2['default'].getNextNode(tmpCurDom, false, null);
        }

        if (s.length === 0) {
            //如果当前未选中 自闭合标签（br）且下一个字符是 自闭合标签 则 扩展选中区域
            if (tmpCurDom && !_domUtilsDomBase2['default'].isSelfClosingTag(tmpCurDom) && tmpNextDom && (tmpNextDom.nodeType !== 1 || tmpNextDom.nodeType === 1 && _domUtilsDomBase2['default'].isSelfClosingTag(tmpNextDom))) {
                sel.modify('extend', direction, 'character');
            }
        } else if (s.indexOf(_commonConst2['default'].FILL_CHAR) > -1 && s.replace(_commonConst2['default'].FILL_CHAR_REG, '') === '') {
            //如果当前选中了 文本 但文本未占位字符，则扩展选中区域
            sel.modify('extend', direction, 'character');
        }
    },
    /**
     * 根据 起始 Dom 位置设定 光标选择范围
     * @param start
     * @param startOffset
     * @param end
     * @param endOffset
     */
    setRange: function setRange(start, startOffset, end, endOffset) {
        if (!start && !end) {
            return;
        }
        var maxStart = _domUtilsDomBase2['default'].getDomEndOffset(start),
            maxEnd = _domUtilsDomBase2['default'].getDomEndOffset(end);
        if (startOffset < 0) {
            startOffset = 0;
        } else if (startOffset > maxStart) {
            startOffset = maxStart;
        }
        if (endOffset < 0) {
            endOffset = _domUtilsDomBase2['default'].getDomEndOffset(end);
        } else if (endOffset > maxEnd) {
            endOffset = maxEnd;
        }
        var sel = _commonEnv2['default'].doc.getSelection();
        if (!start) {
            start = _commonEnv2['default'].doc.body;
            startOffset = 0;
        }
        var range;
        if (sel.rangeCount === 0) {
            range = document.createRange();
            range.selectNode(start);
            sel.addRange(range);
        }
        sel.collapse(start, startOffset);
        if (end) {
            sel.extend(end, endOffset);
        }
    }
};

exports['default'] = rangeUtils;
module.exports = exports['default'];

},{"./../common/const":13,"./../common/env":15,"./../common/utils":19,"./../domUtils/domBase":23}],36:[function(require,module,exports){
/**
 * 范围操作的基本方法集合
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('./../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('./../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('./../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _domUtilsDomExtend = require('./../domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

var _rangeBase = require('./rangeBase');

var _rangeBase2 = _interopRequireDefault(_rangeBase);

var rangeBackup;
_rangeBase2['default'].backupCaret = function () {
    var range = _rangeBase2['default'].getRange();
    if (!range) {
        if (rangeBackup) {
            return true;
        }

        _domUtilsDomExtend2['default'].focus();
        range = _rangeBase2['default'].getRange();
        if (!range) {
            return false;
        }
    }
    rangeBackup = _rangeBase2['default'].getRange();
    return true;
    //rangeBackup.setEnd(rangeBackup.startContainer, rangeBackup.startOffset);
};

_rangeBase2['default'].restoreCaret = function () {
    if (!rangeBackup) {
        return false;
    }
    var sel = _commonEnv2['default'].doc.getSelection();
    if (sel.rangeCount == 0) {
        _domUtilsDomExtend2['default'].focus();
    }
    sel.removeAllRanges();
    sel.addRange(rangeBackup);
    rangeBackup = null;

    return true;
};

/**
 * 在 光标（isCollapse=true）所在位置创建 指定样式的 span
 * make new span when selection's isCollapsed == true
 * @param style
 * @param attr
 */
_rangeBase2['default'].modifyCaretStyle = function (style, attr) {
    var sel = _commonEnv2['default'].doc.getSelection();
    var focusNode = sel.focusNode;
    var range,
        key,
        value,
        hasSameStyle = true,
        n;

    //get the focus's element.
    if (focusNode.nodeType == 3) {
        focusNode = focusNode.parentNode;
    }
    //check if the current dom is same as the style which is needed.
    for (key in style) {
        if (style.hasOwnProperty(key) && typeof key == 'string') {
            value = style[key];
            if (focusNode.style[key] !== value) {
                hasSameStyle = false;
            }
        }
    }
    if (hasSameStyle) {
        return;
    }

    //if current dom is empty, so don't create span.
    if (_domUtilsDomExtend2['default'].isTag(focusNode, 'span') && _commonUtils2['default'].isEmpty(focusNode.innerHTML)) {
        _domUtilsDomExtend2['default'].modifyStyle(focusNode, style, attr);
        n = focusNode;
    } else {
        range = sel.getRangeAt(0);
        range.deleteContents();
        n = _domUtilsDomExtend2['default'].createSpan();
        n.innerHTML = _commonConst2['default'].FILL_CHAR;
        range.insertNode(n);
        _domUtilsDomExtend2['default'].modifyStyle(n, style, attr);
    }

    //put the cursor's position to the target dom
    //range = ENV.doc.createRange();
    //range.setStart(n.childNodes[0], 1);
    //range.setEnd(n.childNodes[0], 1);

    //clear redundant span & TextNode
    //var p = focusNode;
    var p = focusNode.parentNode ? focusNode.parentNode : focusNode;
    _domUtilsDomExtend2['default'].clearChild(p, [n]);

    //reset the selection's range
    _rangeBase2['default'].setRange(n.childNodes[0], 1, n.childNodes[0], 1);
    //sel.removeAllRanges();
    //sel.addRange(range);
};
_rangeBase2['default'].modifyDomsStyle = function (domList, style, attr, excludeList) {
    //modify style
    _domUtilsDomExtend2['default'].modifyNodesStyle(domList, style, attr);
    //clear redundant span & TextNode
    var ps = [],
        i,
        j,
        t,
        tempAmend;
    for (i = 0, j = domList.length; i < j; i++) {
        t = domList[i].parentNode;
        if (!t) {
            continue;
        }
        if (ps.indexOf(t) < 0) {
            ps.push(t);
        }
    }
    //获取需要重构的 dom 集合共同的 parent 节点
    t = _domUtilsDomExtend2['default'].getParentRoot(ps);
    //如果是 修订节点，则找到修订节点的 父节点进行清理操作
    tempAmend = _domUtilsDomExtend2['default'].getWizAmendParent(t);
    t = tempAmend ? tempAmend.parentNode : t;
    _domUtilsDomExtend2['default'].clearChild(t, excludeList);
};
/**
 * 在 光标（isCollapse=false）选择范围内修改所有 dom内容，设置为指定样式
 * modify the style when selection's isCollapsed == false
 * @param style
 * @param attr
 */
_rangeBase2['default'].modifyRangeStyle = function (style, attr) {
    var rangeResult, rangeList, rangeLength;
    //get the RangeList
    rangeResult = _rangeBase2['default'].getRangeDomList({
        noSplit: false
    });
    if (!rangeResult) {
        return;
    }
    rangeList = rangeResult.list;
    rangeLength = rangeList.length;
    if (rangeLength === 0) {
        return;
    }

    //modify style
    _rangeBase2['default'].modifyDomsStyle(rangeList, style, attr, [rangeResult.startDomBak, rangeResult.endDomBak]);

    //reset the selection's range
    //自闭合标签 需要特殊处理
    var isStartBak = !rangeResult.startDom.parentNode,
        isEndBak = !rangeResult.endDom.parentNode,
        isSelfCloseEnd = _domUtilsDomExtend2['default'].isSelfClosingTag(rangeResult.endDom);
    //修正 Bak 的Dom
    if (isStartBak && _domUtilsDomExtend2['default'].isSelfClosingTag(rangeResult.startDomBak)) {
        rangeResult.startDomBak = _domUtilsDomExtend2['default'].getNextNode(rangeResult.startDomBak, false, rangeResult.endDomBak);
        rangeResult.startOffsetBak = 0;
    }
    _rangeBase2['default'].setRange(isStartBak ? rangeResult.startDomBak : rangeResult.startDom, isStartBak ? rangeResult.startOffsetBak : rangeResult.startOffset, isEndBak || isSelfCloseEnd ? rangeResult.endDomBak : rangeResult.endDom, isEndBak || isSelfCloseEnd ? rangeResult.endOffsetBak : rangeResult.endOffset);
};
/**
 * 修改 光标范围内的 Dom 样式 & 属性
 * @param style
 * @param attr
 */
_rangeBase2['default'].modifySelectionDom = function (style, attr) {
    var range = _rangeBase2['default'].getRange();
    if (!range) {
        return;
    }
    if (range.collapsed) {
        _rangeBase2['default'].modifyCaretStyle(style, attr);
    } else {
        _rangeBase2['default'].modifyRangeStyle(style, attr);
    }
};

exports['default'] = _rangeBase2['default'];
module.exports = exports['default'];

},{"./../common/const":13,"./../common/env":15,"./../common/utils":19,"./../domUtils/domExtend":24,"./rangeBase":35}],37:[function(require,module,exports){
/**
 * 阅读器 基础工具包
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _domUtilsDomExtend = require('../domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

var _todoUtilsTodoCore = require('../todoUtils/todoCore');

var _todoUtilsTodoCore2 = _interopRequireDefault(_todoUtilsTodoCore);

var _tableUtilsTableCore = require('../tableUtils/tableCore');

var _tableUtilsTableCore2 = _interopRequireDefault(_tableUtilsTableCore);

var _commonWizStyle = require('../common/wizStyle');

var _commonWizStyle2 = _interopRequireDefault(_commonWizStyle);

var _readerEvent = require('./readerEvent');

var _readerEvent2 = _interopRequireDefault(_readerEvent);

var noteSrc = '';
var reader = {
    init: function init() {},
    insertDefaultStyle: function insertDefaultStyle(isReplace, customCss) {
        _commonWizStyle2['default'].insertDefaultStyle(isReplace, customCss);
    },
    on: function on() {
        noteSrc = _domUtilsDomExtend2['default'].getContentHtml();
        _commonWizStyle2['default'].insertTmpReaderStyle();
        _readerEvent2['default'].on();
        _tableUtilsTableCore2['default'].on();
        _todoUtilsTodoCore2['default'].on();

        //禁用 输入框（主要用于 九宫格 处理）
        setDomReadOnly('input', true);
        setDomReadOnly('textarea', true);
    },
    off: function off() {
        _readerEvent2['default'].off();
        _todoUtilsTodoCore2['default'].off();
        _tableUtilsTableCore2['default'].off();

        if (!noteSrc) {
            return;
        }
        if (_commonEnv2['default'].options.noteType == _commonConst2['default'].NOTE_TYPE.COMMON) {
            _domUtilsDomExtend2['default'].removeDomByName(_commonConst2['default'].NAME.TMP_STYLE);
            _domUtilsDomExtend2['default'].removeDomByTag(_commonConst2['default'].TAG.TMP_TAG);
            setDomReadOnly('input', false);
            setDomReadOnly('textarea', false);
        } else {
            _commonEnv2['default'].doc.open("text/html", "replace");
            _commonEnv2['default'].doc.write(noteSrc);
            _commonEnv2['default'].doc.close();
        }
    }
};

function setDomReadOnly(tag, readonly) {
    var domList = _commonEnv2['default'].doc.getElementsByTagName(tag),
        i,
        obj;
    for (i = 0; i < domList.length; i++) {
        obj = domList[i];
        obj.readOnly = readonly;
    }
}

exports['default'] = reader;
module.exports = exports['default'];

},{"../common/const":13,"../common/env":15,"../common/utils":19,"../common/wizStyle":20,"../domUtils/domExtend":24,"../tableUtils/tableCore":39,"../todoUtils/todoCore":43,"./readerEvent":38}],38:[function(require,module,exports){
/**
 * editor 使用的基本事件处理
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _domUtilsDomExtend = require('../domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

var _imgUtilsImgUtils = require('../imgUtils/imgUtils');

var _imgUtilsImgUtils2 = _interopRequireDefault(_imgUtilsImgUtils);

function clickImg(e) {
    var target = e.target;
    if (!target || !_domUtilsDomExtend2['default'].isTag(target, 'img') || target.className.indexOf('wiz-todo') > -1) {
        return;
    }

    //对于 超链接内的 img 不阻止点击事件，因为响应 超链接 更重要
    var p = _domUtilsDomExtend2['default'].getParentByFilter(target, function (node) {
        return node && _domUtilsDomExtend2['default'].isTag(node, 'a') && /^(http|https|wiz|wiznote|wiznotecmd):/.test(node.getAttribute('href'));
    }, true);

    if (p) {
        return;
    }

    _commonEnv2['default'].client.sendCmdToWiznote(_commonConst2['default'].CLIENT_EVENT.wizReaderClickImg, {
        src: target.src,
        imgList: _commonEnv2['default'].client.type.isAndroid ? _imgUtilsImgUtils2['default'].getAll(true).join(',') : null
    });
    _commonUtils2['default'].stopEvent(e);
    return false;
}

var ReaderEvent = {
    on: function on() {
        ReaderEvent.bind();
    },
    off: function off() {
        ReaderEvent.unbind();
    },
    bind: function bind() {
        ReaderEvent.unbind();
        _commonEnv2['default'].doc.addEventListener('click', handler.onClick);

        if (_commonEnv2['default'].client.type.isIOS || _commonEnv2['default'].client.type.isAndroid) {
            _commonEnv2['default'].doc.addEventListener('touchend', handler.onTouchEnd);
            _commonEnv2['default'].doc.addEventListener('touchstart', handler.onTouchStart);
        }
    },
    unbind: function unbind() {
        _commonEnv2['default'].doc.removeEventListener('click', handler.onClick);
        _commonEnv2['default'].doc.removeEventListener('touchend', handler.onTouchEnd);
        _commonEnv2['default'].doc.removeEventListener('touchstart', handler.onTouchStart);
    }
};

var handler = {
    onClick: function onClick(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_CLICK, e);

        if (_commonEnv2['default'].client.type.isIOS || _commonEnv2['default'].client.type.isAndroid) {
            clickImg(e);
        }
    },
    onTouchEnd: function onTouchEnd(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_TOUCH_END, e);
    },
    onTouchStart: function onTouchStart(e) {
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_TOUCH_START, e);
    }
};

exports['default'] = ReaderEvent;
module.exports = exports['default'];

},{"../common/const":13,"../common/env":15,"../common/utils":19,"../domUtils/domExtend":24,"../imgUtils/imgUtils":29}],39:[function(require,module,exports){
/**
 * 表格操作核心包 core
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _tableUtils = require('./tableUtils');

var _tableUtils2 = _interopRequireDefault(_tableUtils);

var _tableMenu = require('./tableMenu');

var _tableMenu2 = _interopRequireDefault(_tableMenu);

var _tableZone = require('./tableZone');

var _tableZone2 = _interopRequireDefault(_tableZone);

var _domUtilsDomExtend = require('../domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

var _rangeUtilsRangeExtend = require('../rangeUtils/rangeExtend');

var _rangeUtilsRangeExtend2 = _interopRequireDefault(_rangeUtilsRangeExtend);

var _commonHistoryUtils = require('../common/historyUtils');

var _commonHistoryUtils2 = _interopRequireDefault(_commonHistoryUtils);

//TODO 所有配色 要考虑到 夜间模式

var _event = {
    bind: function bind() {
        _event.unbind();
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_DRAG_START, _event.handler.onDragStart);
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_KEY_DOWN, _event.handler.onKeyDown);
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_KEY_UP, _event.handler.onKeyUp);

        if (_commonEnv2['default'].client.type.isPhone || _commonEnv2['default'].client.type.isPad) {
            _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_TOUCH_START, _event.handler.onMouseDown);
            _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_TOUCH_END, _event.handler.onMouseUp);
        } else {
            _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_MOUSE_DOWN, _event.handler.onMouseDown);
            _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_MOUSE_OVER, _event.handler.onMouseOver);
            _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_MOUSE_UP, _event.handler.onMouseUp);
        }
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_SELECT_CHANGE, _event.handler.onSelectionChange);
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.AFTER_RESTORE_HISTORY, _event.handler.afterRestoreHistory);
    },
    unbind: function unbind() {
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_DRAG_START, _event.handler.onDragStart);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_KEY_DOWN, _event.handler.onKeyDown);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_KEY_UP, _event.handler.onKeyUp);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_MOUSE_DOWN, _event.handler.onMouseDown);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_MOUSE_OVER, _event.handler.onMouseOver);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_MOUSE_UP, _event.handler.onMouseUp);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_TOUCH_START, _event.handler.onMouseDown);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_TOUCH_END, _event.handler.onMouseUp);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_SELECT_CHANGE, _event.handler.onSelectionChange);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.AFTER_RESTORE_HISTORY, _event.handler.afterRestoreHistory);
    },
    handler: {
        afterRestoreHistory: function afterRestoreHistory() {
            //恢复历史后，需要修正 zone
            var tmpCells,
                cells = [],
                cell,
                i,
                j;

            tmpCells = _commonEnv2['default'].doc.getElementsByClassName(_commonConst2['default'].CLASS.SELECTED_CELL);

            if (tmpCells.length === 0) {
                _tableZone2['default'].clear();
                return;
            }

            for (i = 0, j = tmpCells.length; i < j; i++) {
                cells.push(tmpCells[i]);
            }

            var table = _domUtilsDomExtend2['default'].getParentByTagName(cells[0], 'table', true, null);
            if (!table) {
                _tableZone2['default'].clear();
                return;
            }

            _tableZone2['default'].setStart(cells[0]);

            var zone = _tableZone2['default'].getZone();
            var endCell = cells[cells.length - 1],
                endCellRange = _tableUtils2['default'].getRangeByCellData(_tableUtils2['default'].getCellData(zone.grid, endCell)),
                cellRange;

            for (i = 1; i < cells.length - 1; i++) {
                cell = cells[i];
                if (cell.rowSpan == 1) {
                    continue;
                }
                cellRange = _tableUtils2['default'].getRangeByCellData(_tableUtils2['default'].getCellData(zone.grid, cell));
                if (cellRange.maxY > endCellRange.maxY || (cellRange.maxY = endCellRange.maxY && cellRange.maxX > endCellRange.maxX)) {
                    endCell = cell;
                    endCellRange = cellRange;
                }
            }

            _tableZone2['default'].setEnd(endCell);

            //修正 Menu
            _tableMenu2['default'].show();
        },
        onDragStart: function onDragStart(e) {
            //表格内禁止拖拽操作
            var table = _domUtilsDomExtend2['default'].getParentByTagName(e.target, 'table', true, null);
            if (table) {
                _commonUtils2['default'].stopEvent(e);
            }
        },
        onKeyDown: function onKeyDown(e) {
            var sel = _commonEnv2['default'].doc.getSelection();
            var zone = _tableZone2['default'].getZone();
            if (!zone.range) {
                return;
            }

            var code = e.keyCode || e.which,
                direct,
                charMove = false,
                oldCur = sel.focusNode,
                newCur;
            switch (code) {
                case 37:
                    //left
                    if (e.ctrlKey && oldCur) {
                        charMove = true;
                        sel.modify('move', 'backward', 'character');
                    }
                    direct = { x: -1, y: 0 };
                    break;
                case 38:
                    //up
                    if (e.ctrlKey && oldCur) {
                        charMove = true;
                        sel.modify('move', 'backward', 'line');
                    }
                    direct = { x: 0, y: -1 };
                    break;
                case 9:
                    //Tab
                    if (!e.shiftKey) {
                        direct = { x: 1, y: 0, canChangeRow: true };
                    }
                    break;
                case 39:
                    //right
                    if (e.ctrlKey && oldCur) {
                        charMove = true;
                        sel.modify('move', 'forward', 'character');
                    }
                    direct = { x: 1, y: 0 };
                    break;
                case 13:
                    //Enter
                    if (!e.ctrlKey) {
                        break;
                    }

                case 40:
                    //down
                    if (e.ctrlKey && oldCur) {
                        charMove = true;
                        sel.modify('move', 'forward', 'line');
                    }
                    direct = { x: 0, y: 1 };
                    break;
            }

            var last, cellData;

            if (charMove) {
                newCur = sel.focusNode;
                oldCur = _domUtilsDomExtend2['default'].getParentByTagName(oldCur, ['td', 'th'], true, null);
                newCur = _domUtilsDomExtend2['default'].getParentByTagName(newCur, ['td', 'th'], true, null);
                if (newCur && newCur != oldCur) {
                    if (code == 38 || code == 40 || code == 13) {
                        charMove = false;
                    } else {
                        _tableZone2['default'].setStart(newCur).setEnd(newCur);
                    }
                }
                if (charMove) {
                    _commonUtils2['default'].stopEvent(e);
                    return;
                }
            }

            if (direct) {
                if (e.shiftKey) {
                    last = zone.end || zone.start;
                } else {
                    last = zone.start;
                }

                cellData = _tableZone2['default'].switchCell(last, direct);
                if (cellData) {
                    if (_tableZone2['default'].isSingleCell() && cellData == zone.grid[zone.range.minY][zone.range.minX]) {
                        if (e.ctrlKey && code == 38) {
                            sel.modify('move', 'forward', 'line');
                        } else if (e.ctrlKey && (code == 40 || code == 13)) {
                            sel.modify('move', 'backward', 'line');
                        }
                    } else if (e.shiftKey) {
                        _tableZone2['default'].setEnd(cellData.cell, true);
                    } else {
                        _tableZone2['default'].setStart(cellData.cell, cellData.x, cellData.y).setEnd(cellData.cell);
                    }
                    _commonUtils2['default'].stopEvent(e);
                }
            }
        },
        onKeyUp: function onKeyUp(e) {
            var zone = _tableZone2['default'].getZone(),
                range = _rangeUtilsRangeExtend2['default'].getRange(),
                cell;
            //从非表格的地方 用键盘移动光标到 单元格内，直接选中该单元格
            if (!zone.range && range && range.collapsed) {
                cell = _domUtilsDomExtend2['default'].getParentByTagName(range.startContainer, ['td', 'th'], true, null);
                if (cell) {
                    _tableZone2['default'].setStart(cell).setEnd(cell);
                }
            }

            _tableUtils2['default'].fixSelection(e);
        },
        onMouseDown: function onMouseDown(e) {
            var isLeft = e.type !== 'mousedown' || e.button === 0 || e.button === 1;
            if (!isLeft) {
                _tableMenu2['default'].hide();
                return;
            }

            var isMenu = _tableMenu2['default'].isMenu(e.target);
            if (isMenu) {
                return;
            }
            //如果在表格上下边缘，且无可编辑区域时，自动添加空行
            _tableZone2['default'].checkAndInsertEmptyLine(e);

            var cell = _domUtilsDomExtend2['default'].getParentByTagName(e.target, ['th', 'td'], true, null);
            var table = cell ? _domUtilsDomExtend2['default'].getParentByTagName(cell, 'table', false, null) : null;
            var pos = _tableUtils2['default'].getMousePosition(e, table);
            var isZoneBorder = _tableZone2['default'].isZoneBorder(e);

            if (isZoneBorder.isBodyBorder || isZoneBorder.isContainer) {
                if (!_commonEnv2['default'].client.type.isPhone && !_commonEnv2['default'].client.type.isPad) {
                    //手机端不能阻止事件，否则会导致点击这些区域无法滚动屏幕
                    _commonUtils2['default'].stopEvent(e);
                }
                return;
            }

            if (!_commonEnv2['default'].client.type.isPhone && !_commonEnv2['default'].client.type.isPad) {
                if (isZoneBorder.isRight) {
                    _tableZone2['default'].startDragColLine(e.target, pos.x);
                    return;
                }
                if (isZoneBorder.isBottom) {
                    _tableZone2['default'].startDragRowLine(e.target, pos.y);
                    return;
                }
                if (isZoneBorder.isDot) {
                    console.log('isDot');
                    return;
                }
            }

            if (isZoneBorder.isBorder || isZoneBorder.isScroll) {
                return;
            }

            _tableZone2['default'].setStart(cell);
            _tableMenu2['default'].show();
        },
        onMouseOver: function onMouseOver(e) {
            var end = _domUtilsDomExtend2['default'].getParentByTagName(e.target, ['td', 'th'], true, null);
            _tableZone2['default'].modify(end);
        },
        onMouseUp: function onMouseUp(e) {
            _tableUtils2['default'].fixSelection(e);

            var isLeft = e.type !== 'mouseup' || e.button === 0 || e.button === 1;
            if (!isLeft) {
                return;
            }
            var isMenu, isZoneBorder;
            var zone = _tableZone2['default'].getZone();
            //当前正在选择单元格时， 不考虑 up 的位置是否 menu 等
            if (!zone.active) {
                isMenu = _tableMenu2['default'].isMenu(e.target);
                if (isMenu) {
                    return;
                }

                isZoneBorder = _tableZone2['default'].isZoneBorder(e);
                if (isZoneBorder.isRight && !_tableZone2['default'].isRangeActiving()) {
                    return;
                }
                if (isZoneBorder.isBottom && !_tableZone2['default'].isRangeActiving()) {
                    return;
                }
                if (isZoneBorder.isDot) {
                    console.log('isDot');
                    return;
                }
                if (isZoneBorder.isBorder || isZoneBorder.isScroll) {
                    return;
                }
            }
            var cell = _domUtilsDomExtend2['default'].getParentByTagName(e.target, ['td', 'th'], true, null);
            _tableZone2['default'].setEnd(cell);
            _tableMenu2['default'].show();
        },
        onSelectionChange: function onSelectionChange(e) {
            var check = _tableUtils2['default'].checkCaretInTableContainer(e);
            var zone = _tableZone2['default'].getZone();
            var cell;
            if (check.tableContainer && zone.table !== check.tableContainer.querySelector('table')) {
                //如果光标定位在 table & table container 之间，则定位到 table 内第一个 td
                cell = check.tableContainer.querySelectorAll('td');
                cell = check.after ? cell[cell.length - 1] : check.before ? cell[0] : null;
                if (cell) {
                    _tableZone2['default'].setStart(cell).setEnd(cell);
                }
            }
        }
    }
};

var tableCore = {
    on: function on() {
        if (!_commonEnv2['default'].readonly) {
            _event.bind();
            _tableMenu2['default'].init(tableCore);
        }
        _tableUtils2['default'].initTableContainer(null);
        _tableZone2['default'].clear();
    },
    off: function off() {
        _tableZone2['default'].clear();
    },
    canCreateTable: function canCreateTable() {
        return _tableUtils2['default'].canCreateTable(_tableZone2['default'].getZone());
    },
    clearCellValue: function clearCellValue() {
        var zone = _tableZone2['default'].getZone();
        if (!zone.range) {
            return;
        }
        _commonHistoryUtils2['default'].saveSnap(false);
        _tableUtils2['default'].clearCellValue(zone.grid, zone.range);
    },
    deleteCols: function deleteCols() {
        var zone = _tableZone2['default'].getZone();
        if (!zone.range) {
            return;
        }
        if (zone.range.minX === 0 && zone.range.maxX === zone.grid[0].length - 1) {
            tableCore.deleteTable();
            return;
        }

        _commonHistoryUtils2['default'].saveSnap(false);
        var i;
        for (i = zone.range.maxX; i >= zone.range.minX; i--) {
            _tableUtils2['default'].deleteCols(zone.grid, i);
        }
        _tableZone2['default'].clear();
    },
    deleteRows: function deleteRows() {
        var zone = _tableZone2['default'].getZone();
        if (!zone.range) {
            return;
        }
        if (zone.range.minY === 0 && zone.range.maxY === zone.grid.length - 1) {
            tableCore.deleteTable();
            return;
        }

        _commonHistoryUtils2['default'].saveSnap(false);
        var i;
        for (i = zone.range.maxY; i >= zone.range.minY; i--) {
            _tableUtils2['default'].deleteRows(zone.grid, i);
        }
        _tableZone2['default'].clear();
    },
    deleteTable: function deleteTable() {
        var zone = _tableZone2['default'].getZone();
        if (!zone.table) {
            return;
        }
        _commonHistoryUtils2['default'].saveSnap(false);

        var parent = zone.table.parentNode;
        if (parent) {
            parent.removeChild(zone.table);
        }
        _tableMenu2['default'].remove();
        _tableZone2['default'].remove();
        parent = _domUtilsDomExtend2['default'].getParentByFilter(parent, function (dom) {
            return _domUtilsDomExtend2['default'].hasClass(dom, _commonConst2['default'].CLASS.TABLE_CONTAINER);
        }, true);

        var enter;
        if (parent) {
            enter = _commonEnv2['default'].doc.createElement('br');
            parent.parentNode.insertBefore(enter, parent);
            parent.parentNode.removeChild(parent);
            _rangeUtilsRangeExtend2['default'].setRange(enter, 0);
        }
    },
    distributeCols: function distributeCols() {
        var zone = _tableZone2['default'].getZone();
        if (!zone.range) {
            return;
        }
        _commonHistoryUtils2['default'].saveSnap(false);
        _tableUtils2['default'].distributeCols(zone.table, zone.grid);
        _tableZone2['default'].updateGrid();
    },
    insertCol: function insertCol(before) {
        var zone = _tableZone2['default'].getZone();
        if (!zone.range) {
            return;
        }
        _commonHistoryUtils2['default'].saveSnap(false);
        _tableUtils2['default'].insertCol(zone.grid, before ? zone.range.minX : zone.range.maxX + 1);
        _tableZone2['default'].updateGrid();
    },
    insertRow: function insertRow(before) {
        var zone = _tableZone2['default'].getZone();
        if (!zone.range) {
            return;
        }
        _commonHistoryUtils2['default'].saveSnap(false);
        _tableUtils2['default'].insertRow(zone.grid, before ? zone.range.minY : zone.range.maxY + 1);
        _tableZone2['default'].updateGrid();
    },
    insertTable: function insertTable(col, row) {
        _commonHistoryUtils2['default'].saveSnap(false);
        var range = _rangeUtilsRangeExtend2['default'].getRange();
        var tmpCell;

        if (!tableCore.canCreateTable()) {
            return;
        }
        if (range) {
            range.deleteContents();
            range = _rangeUtilsRangeExtend2['default'].getRange();
        }
        var table = _tableUtils2['default'].createTable(col, row);
        // var fillChar = domUtils.createSpan();
        // fillChar.innerHTML = CONST.FILL_CHAR + '234';
        var br = _commonEnv2['default'].doc.createElement('div');
        br.appendChild(_commonEnv2['default'].doc.createElement('br'));

        if (range) {
            // if (ENV.doc.queryCommandSupported('insertHTML')) {
            //     ENV.doc.execCommand('insertHTML', false, fillChar.outerHTML + table.outerHTML + br.outerHTML);
            // } else {
            _commonEnv2['default'].doc.execCommand('insertparagraph');
            range = _rangeUtilsRangeExtend2['default'].getRange();
            range.insertNode(table);
            range.insertNode(br);
            // }
        } else {
                _commonEnv2['default'].doc.body.appendChild(table);
                _commonEnv2['default'].doc.body.appendChild(br);
            }
        _tableUtils2['default'].initTableContainer(null);

        //修正 光标
        range = _rangeUtilsRangeExtend2['default'].getRange();
        tmpCell = _domUtilsDomExtend2['default'].getParentByTagName(range.startContainer, ['tbody'], true, null);
        if (tmpCell) {
            _rangeUtilsRangeExtend2['default'].setRange(_domUtilsDomExtend2['default'].getFirstDeepChild(tmpCell), 0);
        }
    },
    merge: function merge() {
        var zone = _tableZone2['default'].getZone();
        if (!zone.range) {
            return;
        }
        _commonHistoryUtils2['default'].saveSnap(false);
        var cell = _tableUtils2['default'].mergeCell(zone.grid, zone.range);
        if (cell) {
            _tableZone2['default'].updateGrid();
            _tableZone2['default'].setStart(cell).setEnd(cell);
        }
    },
    setCellAlign: function setCellAlign(align, valign) {
        var zone = _tableZone2['default'].getZone();
        if (!zone.range) {
            return;
        }
        _commonHistoryUtils2['default'].saveSnap(false);
        _tableUtils2['default'].setCellAlign(zone.grid, zone.range, {
            align: align,
            valign: valign
        });
        _tableZone2['default'].setStartRange();
    },
    setCellBg: function setCellBg(bgColor) {
        var zone = _tableZone2['default'].getZone();
        if (!zone.range) {
            return;
        }
        _commonHistoryUtils2['default'].saveSnap(false);
        _tableUtils2['default'].setCellBg(zone.grid, zone.range, bgColor);
        _tableZone2['default'].setStartRange();
    },
    split: function split() {
        var zone = _tableZone2['default'].getZone();
        var range = _tableUtils2['default'].splitCell(zone.table, zone.grid, zone.range);
        if (range) {
            _commonHistoryUtils2['default'].saveSnap(false);
            _tableZone2['default'].updateGrid();
            zone = _tableZone2['default'].getZone();
            _tableZone2['default'].setStart(zone.grid[range.minY][range.minX].cell).setEnd(zone.grid[range.maxY][range.maxX].cell);
        }
    }
};

exports['default'] = tableCore;
module.exports = exports['default'];

},{"../common/const":13,"../common/env":15,"../common/historyUtils":16,"../common/utils":19,"../domUtils/domExtend":24,"../rangeUtils/rangeExtend":36,"./tableMenu":40,"./tableUtils":41,"./tableZone":42}],40:[function(require,module,exports){
/*
 表格菜单 控制
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonLang = require('../common/lang');

var _commonLang2 = _interopRequireDefault(_commonLang);

// import utils from '../common/utils';

var _tableUtils = require('./tableUtils');

var _tableUtils2 = _interopRequireDefault(_tableUtils);

var _tableZone = require('./tableZone');

var _tableZone2 = _interopRequireDefault(_tableZone);

var _domUtilsDomExtend = require('../domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

//import wizStyle from '../common/wizStyle';

var colorPadDemo;
var _id = {
    col: 'wiz-menu-col',
    align: 'wiz-menu-align',
    bg: 'wiz-menu-bg',
    bgDemo: 'wiz-menu-bg-demo',
    cells: 'wiz-menu-cells',
    more: 'wiz-menu-more'
};
var _class = {
    active: 'active',
    disabled: 'disabled',
    clickItem: 'click-item',
    colorPadItem: 'wiz-table-color-pad-item',
    alignItem: 'wiz-table-cell-align-item'
};
var _subType = {
    list: 1,
    custom: 2
};

var tableCore;
var menuObj;

function createMenu() {
    var menu = _commonEnv2['default'].doc.querySelector('.' + _commonConst2['default'].CLASS.TABLE_TOOLS);
    if (menu) {
        return menu;
    }

    var menuData = [{
        id: _id.col,
        exClass: 'icon-insert editor-icon',
        subMenu: {
            type: _subType.list,
            data: [{
                type: _commonConst2['default'].TYPE.TABLE.INSERT_ROW_UP,
                name: _commonLang2['default'].Table.InsertRowUp,
                isSplit: false
            }, {
                type: _commonConst2['default'].TYPE.TABLE.INSERT_ROW_DOWN,
                name: _commonLang2['default'].Table.InsertRowDown,
                isSplit: false
            }, {
                type: _commonConst2['default'].TYPE.TABLE.INSERT_COL_LEFT,
                name: _commonLang2['default'].Table.InsertColLeft,
                isSplit: false
            }, {
                type: _commonConst2['default'].TYPE.TABLE.INSERT_COL_RIGHT,
                name: _commonLang2['default'].Table.InsertColRight,
                isSplit: false
            }, {
                type: _commonConst2['default'].TYPE.TABLE.DELETE_ROW,
                name: _commonLang2['default'].Table.DeleteRow,
                isSplit: true
            }, {
                type: _commonConst2['default'].TYPE.TABLE.DELETE_COL,
                name: _commonLang2['default'].Table.DeleteCol,
                isSplit: false
            }]
        }
    }, {
        id: _id.align,
        exClass: 'icon-align editor-icon',
        subMenu: {
            type: _subType.custom,
            make: function make() {
                var typeList = [['top', 'middle', 'bottom'], ['left', 'center', 'right']];
                var i, j, dataAlignType;
                var str = '<div class="wiz-table-menu-sub wiz-table-cell-align">';
                for (i = 0; i < typeList.length; i++) {
                    str += '<div>';
                    for (j = 0; j < typeList[i].length; j++) {
                        dataAlignType = i === 0 ? 'valign' : 'align';
                        str += '<div class="' + _class.alignItem + ' ' + _class.clickItem + '" data-type="' + _commonConst2['default'].TYPE.TABLE.SET_CELL_ALIGN + '" data-align-type="' + dataAlignType + '" data-align-value="' + typeList[i][j] + '">';
                        if (i === 0) {
                            str += '<i class="editor-icon icon-box"></i>';
                            str += '<i class="editor-icon valign icon-valign_' + typeList[i][j] + '"></i>';
                        } else {
                            str += '<i class="editor-icon align icon-align_' + typeList[i][j] + '"></i>';
                        }

                        str += '</div>';
                    }
                    str += '</div>';
                }
                str += '</div>';

                return str;
            }
        }
    }, {
        id: _id.bg,
        exClass: 'icon-box editor-icon',
        subMenu: {
            type: _subType.custom,
            make: function make() {
                var colors = [['', '#f7b6ff', '#fecf9c'], ['#acf3fe', '#b2ffa1', '#b6caff'], ['#ffc7c8', '#eeeeee', '#fef49c']];
                var i, j;
                var str = '<div class="wiz-table-menu-sub wiz-table-color-pad">';
                for (i = 0; i < colors.length; i++) {
                    str += '<div>';
                    for (j = 0; j < colors[i].length; j++) {
                        str += '<div class="' + _class.colorPadItem + ' ' + _class.clickItem + '" data-color="' + colors[i][j] + '" data-type="' + _commonConst2['default'].TYPE.TABLE.SET_CELL_BG + '">';
                        str += '<i class="editor-icon icon-box"></i>';
                        if (i === 0 && j === 0) {
                            str += '<i class="pad-demo editor-icon icon-oblique_line"></i>';
                        } else {
                            str += '<i class="pad-demo editor-icon icon-inner_box" style="color:' + colors[i][j] + ';"></i>';
                        }
                        str += '</div>';
                    }
                    str += '</div>';
                }
                str += '</div>';
                return str;
            }
        }
    }, {
        id: _id.cells,
        exClass: 'icon-merge editor-icon',
        subMenu: {
            type: _subType.list,
            data: [{
                type: _commonConst2['default'].TYPE.TABLE.MERGE_CELL,
                name: _commonLang2['default'].Table.MergeCell,
                // exClass: tableZone.isSingleCell() ? 'disabled' : '',
                isSplit: false
            }, {
                type: _commonConst2['default'].TYPE.TABLE.SPLIT_CELL,
                name: _commonLang2['default'].Table.SplitCell,
                // exClass: tableZone.hasMergeCell() ? '' : 'disabled',
                isSplit: false
            }, {
                type: _commonConst2['default'].TYPE.TABLE.CLEAR_CELL,
                name: _commonLang2['default'].Table.ClearCell,
                isSplit: false
            }]
        }
    }, {
        id: _id.more,
        exClass: 'icon-more editor-icon',
        subMenu: {
            type: _subType.list,
            data: [{
                type: _commonConst2['default'].TYPE.TABLE.DISTRIBUTE_COLS,
                name: _commonLang2['default'].Table.DistributeCols,
                exClass: '',
                isSplit: false
            }, {
                type: _commonConst2['default'].TYPE.TABLE.DELETE_TABLE,
                name: _commonLang2['default'].Table.DeleteTable,
                exClass: '',
                isSplit: true
            }]
        }
    }];

    var i, m;

    menu = _commonEnv2['default'].doc.createElement(_commonConst2['default'].TAG.TMP_TAG);
    _domUtilsDomExtend2['default'].addClass(menu, _commonConst2['default'].CLASS.TABLE_TOOLS);

    var menuHtml = '<ul>';
    for (i = 0; i < menuData.length; i++) {
        m = menuData[i];
        menuHtml += '<li id="' + m.id + '" class="' + _commonConst2['default'].CLASS.TABLE_MENU_ITEM + '">' + '<div class="' + _commonConst2['default'].CLASS.TABLE_MENU_BUTTON + '">' + '<i class="' + m.exClass + '"></i>';
        if (m.id === _id.bg) {
            menuHtml += '<i id="' + _id.bgDemo + '" class="editor-icon icon-inner_box"></i>';
        }
        menuHtml += '</div>';
        if (m.subMenu.type === _subType.list) {
            menuHtml += createSubMenuForList(m.subMenu.data);
        } else {
            menuHtml += m.subMenu.make();
        }
        menuHtml += '</li>';
    }
    menuHtml += '</ul>';
    menu.innerHTML = menuHtml;

    colorPadDemo = menu.querySelector('#' + _id.bgDemo);
    if (colorPadDemo) {
        colorPadDemo.style.color = '#fff';
    }

    return menu;
}

function createSubMenuForList(data) {
    var i,
        m,
        html = '<ul class="wiz-table-menu-sub">';
    for (i = 0; i < data.length; i++) {
        m = data[i];
        html += '<li class="wiz-table-menu-sub-item ' + _class.clickItem;
        if (m.isSplit) {
            html += ' split';
        }
        html += '" data-type="' + m.type + '">' + m.name;
        html += '</li>';
    }
    html += '</ul>';
    return html;
}

function getMenuTop() {
    var top,
        tableBody = menuObj.parentNode.querySelector('.' + _commonConst2['default'].CLASS.TABLE_BODY),
        tableBodyTop = tableBody ? tableBody.offsetTop : 0;
    top = tableBodyTop - menuObj.offsetHeight - 5;
    return top + 'px';
}
function fixMenuPos() {
    var container = menuObj.parentNode,
        offset = _domUtilsDomExtend2['default'].getOffset(container),
        scrollTop = _commonEnv2['default'].doc.body.scrollTop;

    if (scrollTop > offset.top - 30 && scrollTop < container.offsetHeight + offset.top - menuObj.offsetHeight * 2.5) {
        _domUtilsDomExtend2['default'].css(menuObj, {
            position: 'fixed',
            top: '0',
            left: offset.left + 'px'
        });
    } else {
        _domUtilsDomExtend2['default'].css(menuObj, {
            position: '',
            top: getMenuTop(),
            left: ''
        });
    }
}

var _event = {
    bind: function bind() {
        _event.unbind();
        if (menuObj) {
            menuObj.addEventListener('click', _event.handler.onClick);
            menuObj.addEventListener('mouseover', _event.handler.onMouseOver);
        }
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.BEFORE_SAVESNAP, _event.handler.onBeforeSaveSnap);
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_SCROLL, _event.handler.onScroll);
    },
    unbind: function unbind() {
        if (menuObj) {
            menuObj.removeEventListener('click', _event.handler.onClick);
            menuObj.removeEventListener('mouseover', _event.handler.onMouseOver);
        }
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.BEFORE_SAVESNAP, _event.handler.onBeforeSaveSnap);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_SCROLL, _event.handler.onScroll);
    },
    handler: {
        onBeforeSaveSnap: function onBeforeSaveSnap() {
            // 目前不在保存快照前处理
            // tableMenu.hideSub();
        },
        onClick: function onClick(e) {
            //点击 一级菜单
            var item = _domUtilsDomExtend2['default'].getParentByFilter(e.target, function (dom) {
                return _domUtilsDomExtend2['default'].hasClass(dom, _commonConst2['default'].CLASS.TABLE_MENU_BUTTON);
            }, true);
            if (item) {
                tableMenu.showSub(item.parentNode);
                return;
            }

            //点击 菜单具体功能
            var container;
            item = _domUtilsDomExtend2['default'].getParentByFilter(e.target, function (dom) {
                return _domUtilsDomExtend2['default'].hasClass(dom, _class.clickItem);
            }, true);
            if (!item || _domUtilsDomExtend2['default'].hasClass(item, _class.disabled)) {
                return;
            }
            var type = item.getAttribute('data-type');
            var todo = true;
            switch (type) {
                case _commonConst2['default'].TYPE.TABLE.CLEAR_CELL:
                    tableCore.clearCellValue();
                    break;
                case _commonConst2['default'].TYPE.TABLE.MERGE_CELL:
                    tableCore.merge();
                    break;
                case _commonConst2['default'].TYPE.TABLE.SPLIT_CELL:
                    tableCore.split();
                    break;
                case _commonConst2['default'].TYPE.TABLE.INSERT_ROW_UP:
                    tableCore.insertRow(true);
                    break;
                case _commonConst2['default'].TYPE.TABLE.INSERT_ROW_DOWN:
                    tableCore.insertRow();
                    break;
                case _commonConst2['default'].TYPE.TABLE.INSERT_COL_LEFT:
                    tableCore.insertCol(true);
                    break;
                case _commonConst2['default'].TYPE.TABLE.INSERT_COL_RIGHT:
                    tableCore.insertCol();
                    break;
                case _commonConst2['default'].TYPE.TABLE.DELETE_ROW:
                    tableCore.deleteRows();
                    break;
                case _commonConst2['default'].TYPE.TABLE.DELETE_COL:
                    tableCore.deleteCols();
                    break;
                case _commonConst2['default'].TYPE.TABLE.SET_CELL_BG:
                    var bg = item.getAttribute('data-color');
                    tableCore.setCellBg(bg);
                    container = _domUtilsDomExtend2['default'].getParentByFilter(item, function (dom) {
                        return _domUtilsDomExtend2['default'].hasClass(dom, 'wiz-table-color-pad');
                    }, false);
                    _domUtilsDomExtend2['default'].removeClass(container.querySelectorAll('.wiz-table-color-pad .' + _class.colorPadItem + '.' + _class.active), _class.active);
                    _domUtilsDomExtend2['default'].addClass(item, _class.active);
                    colorPadDemo.setAttribute('data-last-color', bg);
                    break;
                case _commonConst2['default'].TYPE.TABLE.SET_CELL_ALIGN:
                    //设置 对齐方式 时，不自动隐藏二级菜单
                    var align = null,
                        valign = null;
                    if (item.getAttribute('data-align-type') == 'align') {
                        align = item.getAttribute('data-align-value');
                    } else {
                        valign = item.getAttribute('data-align-value');
                    }
                    tableCore.setCellAlign(align, valign);

                    container = item.parentNode;
                    _domUtilsDomExtend2['default'].removeClass(container.querySelectorAll('.' + _class.active), _class.active);
                    _domUtilsDomExtend2['default'].addClass(item, _class.active);
                    todo = false;
                    break;
                case _commonConst2['default'].TYPE.TABLE.DELETE_TABLE:
                    tableCore.deleteTable();
                    break;
                case _commonConst2['default'].TYPE.TABLE.DISTRIBUTE_COLS:
                    tableCore.distributeCols();
                    break;
                default:
                    todo = false;
            }

            if (todo) {
                tableMenu.hideSub();
            }
        },
        onMouseOver: function onMouseOver(e) {
            var colorItem = _domUtilsDomExtend2['default'].getParentByFilter(e.target, function (dom) {
                return _domUtilsDomExtend2['default'].hasClass(dom, _class.colorPadItem);
            }, true);
            if (colorItem && colorPadDemo) {
                colorPadDemo.style.color = colorItem.getAttribute('data-color') || '#fff';
            }
        },
        onScroll: function onScroll(e) {
            if (!menuObj || menuObj.style.display == 'none') {
                return;
            }
            fixMenuPos();
        }
    }
};

var tableMenu = {
    init: function init(_tableCore) {
        tableCore = _tableCore;
    },
    hide: function hide() {
        if (menuObj) {
            menuObj.style.display = 'none';
        }
        _event.unbind();
    },
    hideSub: function hideSub() {
        if (!menuObj) {
            return;
        }
        var sub = menuObj.querySelectorAll('.' + _commonConst2['default'].CLASS.TABLE_MENU_ITEM + '.' + _class.active);
        _domUtilsDomExtend2['default'].removeClass(sub, _class.active);

        if (colorPadDemo) {
            colorPadDemo.style.color = colorPadDemo.getAttribute('data-last-color') || '#fff';
        }
    },
    isMenu: function isMenu(dom) {
        if (!dom) {
            return false;
        }
        return !!_domUtilsDomExtend2['default'].getParentByFilter(dom, function (p) {
            return _domUtilsDomExtend2['default'].hasClass(p, _commonConst2['default'].CLASS.TABLE_TOOLS);
        }, true);
    },
    remove: function remove() {
        if (menuObj) {
            menuObj.parentNode.removeChild(menuObj);
            menuObj = null;
        }
    },
    show: function show() {
        if (_commonEnv2['default'].client.type.isPhone || _commonEnv2['default'].client.type.isPad) {
            return;
        }
        var zone = _tableZone2['default'].getZone();
        if (!zone.grid || !zone.range) {
            tableMenu.hide();
            return;
        }

        var container = _domUtilsDomExtend2['default'].getParentByFilter(zone.table, function (dom) {
            return _domUtilsDomExtend2['default'].hasClass(dom, _commonConst2['default'].CLASS.TABLE_CONTAINER);
        }, false);
        menuObj = createMenu();
        _domUtilsDomExtend2['default'].attr(menuObj, {
            contenteditable: 'false'
        });
        tableMenu.hideSub();
        container.appendChild(menuObj);
        _domUtilsDomExtend2['default'].css(menuObj, {
            top: getMenuTop()
        });
        menuObj.style.display = 'block';

        fixMenuPos();
        _event.bind();
    },
    showSub: function showSub(item) {
        if (_domUtilsDomExtend2['default'].hasClass(item, _class.active)) {
            _domUtilsDomExtend2['default'].removeClass(item, _class.active);
            return;
        }

        //控制二级菜单 默认值
        var canMerge,
            canSplit,
            cellAlign,
            subItem,
            zone = _tableZone2['default'].getZone();
        if (item.id === _id.cells) {
            canMerge = _tableUtils2['default'].canMerge(zone.grid, zone.range);
            canSplit = _tableUtils2['default'].canSplit(zone.grid, zone.range);

            subItem = item.querySelector('[data-type=' + _commonConst2['default'].TYPE.TABLE.MERGE_CELL + ']');
            if (subItem && canMerge) {
                _domUtilsDomExtend2['default'].removeClass(subItem, _class.disabled);
            } else if (subItem) {
                _domUtilsDomExtend2['default'].addClass(subItem, _class.disabled);
            }

            subItem = item.querySelector('[data-type=' + _commonConst2['default'].TYPE.TABLE.SPLIT_CELL + ']');
            if (subItem && canSplit) {
                _domUtilsDomExtend2['default'].removeClass(subItem, _class.disabled);
            } else if (subItem) {
                _domUtilsDomExtend2['default'].addClass(subItem, _class.disabled);
            }
        } else if (item.id === _id.align) {
            cellAlign = _tableUtils2['default'].getAlign(zone.grid, zone.range);
            subItem = item.querySelector('.' + _class.alignItem + '.' + _class.active + '[data-align-type=align]');
            if (subItem && (!cellAlign.align || subItem.getAttribute('data-align-value').toLowerCase() !== cellAlign.align)) {
                _domUtilsDomExtend2['default'].removeClass(subItem, _class.active);
                subItem = null;
            }
            if (!subItem && cellAlign.align) {
                subItem = item.querySelector('[data-align-value=' + cellAlign.align + ']');
                _domUtilsDomExtend2['default'].addClass(subItem, _class.active);
            }

            subItem = item.querySelector('.' + _class.alignItem + '.' + _class.active + '[data-align-type=valign]');
            if (subItem && (!cellAlign.valign || subItem.getAttribute('data-align-value').toLowerCase() !== cellAlign.valign)) {
                _domUtilsDomExtend2['default'].removeClass(subItem, _class.active);
                subItem = null;
            }
            if (!subItem && cellAlign.valign) {
                subItem = item.querySelector('[data-align-value=' + cellAlign.valign + ']');
                _domUtilsDomExtend2['default'].addClass(subItem, _class.active);
            }
        }

        tableMenu.hideSub();
        _domUtilsDomExtend2['default'].addClass(item, _class.active);
    }
};

exports['default'] = tableMenu;
module.exports = exports['default'];

},{"../common/const":13,"../common/env":15,"../common/lang":17,"../domUtils/domExtend":24,"./tableUtils":41,"./tableZone":42}],41:[function(require,module,exports){
/**
 * 表格操作的基本方法集合
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('./../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('./../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('./../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _domUtilsDomExtend = require('./../domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

var _rangeUtilsRangeExtend = require('../rangeUtils/rangeExtend');

var _rangeUtilsRangeExtend2 = _interopRequireDefault(_rangeUtilsRangeExtend);

/**
 * table 相关的 默认值
 *
 */

var tableUtils = {
    /**
     * 初始化 默认值
     * @param options
     */
    init: function init() {},
    /**
     * 判断当前是否允许新建表格
     * @param zone
     * @returns {boolean}
     */
    canCreateTable: function canCreateTable(zone) {
        var range = _rangeUtilsRangeExtend2['default'].getRange(),
            tmpCell;
        if (range) {
            tmpCell = _domUtilsDomExtend2['default'].getParentByTagName(range.startContainer, ['table'], true, null) || _domUtilsDomExtend2['default'].getParentByTagName(range.endContainer, ['table'], true, null);
            if (tmpCell) {
                return false;
            }
        }
        return !zone.range;
    },
    /**
     * 判断选择的单元格是否能进行 合并操作
     * @param grid
     * @param range
     * @returns {*|boolean}
     */
    canMerge: function canMerge(grid, range) {
        return grid && range && grid[range.minY][range.minX].cell !== grid[range.maxY][range.maxX].cell;
    },
    /**
     * 判断选择的单元格是否能被拆分
     * @param grid
     * @param range
     * @returns {*}
     */
    canSplit: function canSplit(grid, range) {
        if (!grid || !range) {
            return false;
        }
        var key;
        var splitMap = {},
            canSplit = false;
        tableUtils.eachRange(grid, range, function (cellData) {
            key = cellData.x_src + '_' + cellData.y_src;
            if (cellData.fake && !splitMap[key]) {
                splitMap[key] = grid[cellData.y_src][cellData.x_src];
                canSplit = true;
            }
        });
        return canSplit ? splitMap : false;
    },
    /**
     * 检查 光标是否处于 table & tableContainer 之间
     * @param e
     * @returns {{tableContainer: null, before: boolean, after: boolean}}
     */
    checkCaretInTableContainer: function checkCaretInTableContainer(e) {
        var result = {
            tableContainer: null,
            before: false,
            after: false
        };
        var range, tableContainer, table, target, startOffset;
        var eType = /^(mouse|touch)/i;

        if (e && eType.test(e.type)) {
            //mouse || touch 事件触发时， selection 并没有被改变，所以不能使用 range 进行判断
            target = e.target;
        } else {
            range = _rangeUtilsRangeExtend2['default'].getRange();
            if (!range || !range.collapsed) {
                //选择区域 由 keyUp & mouseUp 中的 tableUtils.fixSelection(e); 进行过滤
                return result;
            }
            target = range.startContainer;
            startOffset = range.startOffset;

            if (target.nodeType === 1) {
                target = target.childNodes[startOffset];
            } else if (target.nodeType === 3 && startOffset == _domUtilsDomExtend2['default'].getDomEndOffset(target)) {
                target = target.nextSibling;
            }
        }

        tableContainer = tableUtils.getContianerExcludeTable(target);

        if (tableContainer) {
            result.tableContainer = tableContainer;
            if (e && eType.test(e.type)) {
                table = tableContainer.querySelector('table');
            } else if (startOffset > 0) {
                result.after = true;
            } else {
                result.before = true;
            }
        }
        return result;
    },
    /**
     * 清空选中区域单元格内的数据
     * @param grid
     * @param range
     */
    clearCellValue: function clearCellValue(grid, range) {
        if (!grid || !range) {
            return;
        }
        tableUtils.eachRange(grid, range, function (cellData) {
            if (!cellData.fake) {
                cellData.cell.innerHTML = '<br/>';
            }
        });
    },
    /**
     * 复制单元格 Dom
     * @param cell
     * @param isClear
     * @returns {Element}
     */
    cloneCell: function cloneCell(cell, isClear) {
        var newCell = _commonEnv2['default'].doc.createElement(cell.tagName);
        newCell.style.cssText = cell.style.cssText;
        if (isClear) {
            newCell.innerHTML = '<br/>';
        } else {
            newCell.colSpan = cell.colSpan;
            newCell.rowSpan = cell.rowSpan;
            newCell.innerHTML = cell.innerHTML;
        }
        // TODO 处理 已选中的 cell
        return newCell;
    },
    /**
     * 创建 单元格
     * @param width
     * @returns {Element}
     */
    createCell: function createCell(width) {
        var td = _commonEnv2['default'].doc.createElement('td');
        td.setAttribute('align', 'left');
        td.setAttribute('valign', 'middle');
        if (width) {
            td.setAttribute('style', 'width:' + width + 'px');
        }
        td.appendChild(_commonEnv2['default'].doc.createElement('br'));
        return td;
    },
    /**
     * 创建 表格
     * @param col
     * @param row
     * @returns {Element}
     */
    createTable: function createTable(col, row) {
        if (!col || !row) {
            return;
        }

        var table = _commonEnv2['default'].doc.createElement('table'),
            tbody = _commonEnv2['default'].doc.createElement('tbody'),
            tr,
            c,
            r;

        for (r = 0; r < row; r++) {
            tr = _commonEnv2['default'].doc.createElement('tr');
            for (c = 0; c < col; c++) {
                tr.appendChild(tableUtils.createCell(_commonEnv2['default'].options.table.colWidth));
            }
            tbody.appendChild(tr);
        }

        table.appendChild(tbody);
        table.style.width = _commonEnv2['default'].options.table.colWidth * col + 'px';
        return table;
    },
    /**
     * 删除指定的列
     * @param grid
     * @param col
     */
    deleteCols: function deleteCols(grid, col) {
        if (!grid || grid.length === 0 || col > grid[0].length) {
            return;
        }
        var table = _domUtilsDomExtend2['default'].getParentByTagName(grid[0][0].cell, 'table', false, null);

        var tmpCellList = [],
            width = _commonEnv2['default'].options.table.colWidth;

        var y, g, cell;
        for (y = 0; y < grid.length; y++) {
            g = grid[y][col];
            if (g.y_src == y && g.cell.colSpan > 1) {
                g.cell.colSpan--;
                tmpCellList.push(g.cell);
            } else if (g.y_src == y) {
                width = tableUtils.getCellWidth(g.cell);
                g.cell.parentElement.removeChild(g.cell);
            }
            grid[y].splice(col, 1);
        }

        for (y = 0; y < tmpCellList.length; y++) {
            cell = tmpCellList[y];
            cell.style.width = tableUtils.getCellWidth(cell) - width + 'px';
        }

        //如果所有单元格都删除了，则删除表格
        if (!table.getElementsByTagName('td').length && !table.getElementsByTagName('th').length) {
            table.parentElement.removeChild(table);
        } else {
            tableUtils.fixTableWidth(table);
        }
    },
    /**
     * 删除指定的行
     * @param grid
     * @param row
     */
    deleteRows: function deleteRows(grid, row) {
        if (!grid || grid.length === 0 || row > grid.length) {
            return;
        }

        var table = _domUtilsDomExtend2['default'].getParentByTagName(grid[0][0].cell, 'table', false, null),
            rows = table.rows;

        var x, g, cellData;
        for (x = grid[row].length - 1; x >= 0; x--) {
            g = grid[row][x];
            if (g.x_src == x && g.y_src < g.y) {
                g.cell.rowSpan--;
            } else if (g.x_src == x && g.y_src == g.y && g.cell.rowSpan > 1 && row + 1 < grid.length) {
                //row+1 防止表格异常的 rowSpan 设置

                g.cell.rowSpan--;
                cellData = tableUtils.getNextCellDataInRow(grid[row + 1], x);
                cellData = cellData ? cellData.cell : null;
                rows[row + 1].insertBefore(g.cell, cellData);
            }
        }
        grid.splice(row, 1);
        rows[row].parentElement.removeChild(rows[row]);

        //如果所有单元格都删除了，则删除表格
        if (!table.getElementsByTagName('tr').length) {
            table.parentElement.removeChild(table);
        } else {
            tableUtils.fixTableWidth(table);
        }
    },
    /**
     * 平均分配每列
     * @param table
     * @param grid
     */
    distributeCols: function distributeCols(table, grid) {
        if (!table || !grid) {
            return;
        }
        var colCount = grid[0].length;
        if (colCount === 0) {
            return;
        }

        var rows = table.rows,
            w = table.offsetWidth / colCount,
            y,
            x,
            cell;

        for (y = rows.length - 1; y >= 0; y--) {
            for (x = rows[y].cells.length - 1; x >= 0; x--) {
                cell = rows[y].cells[x];
                cell.style.width = w * cell.colSpan + 'px';
            }
        }
        table.style.width = table.offsetWidth + 'px';
    },
    /**
     * each 循环遍历 选中区域的单元格
     * @param grid
     * @param range
     * @param callback
     */
    eachRange: function eachRange(grid, range, callback) {
        if (!grid || !range || !callback || typeof callback !== 'function') {
            return;
        }

        var x,
            y,
            cbBreak = true;
        for (y = range.minY; cbBreak !== false && y < grid.length && y <= range.maxY; y++) {
            for (x = range.minX; cbBreak !== false && x < grid[y].length && x <= range.maxX; x++) {
                cbBreak = callback(grid[y][x]);
            }
        }
    },
    /**
     * 修正选中区域的 selection
     */
    fixSelection: function fixSelection() {
        //避免选择文本时， 选中到 表格内部
        var range = _rangeUtilsRangeExtend2['default'].getRange();
        if (!range || range.collapsed) {
            return;
        }

        var start = range.startContainer,
            startOffset = range.startOffset,
            end = range.endContainer,
            endOffset = range.endOffset,
            startTr = _domUtilsDomExtend2['default'].getParentByFilter(start, function (dom) {
            return _domUtilsDomExtend2['default'].hasClass(dom, _commonConst2['default'].CLASS.TABLE_CONTAINER);
        }, true),
            endTr = _domUtilsDomExtend2['default'].getParentByFilter(end, function (dom) {
            return _domUtilsDomExtend2['default'].hasClass(dom, _commonConst2['default'].CLASS.TABLE_CONTAINER);
        }, true);
        if (!startTr && !endTr || startTr && endTr) {
            return;
        }

        var table,
            target = startTr ? startTr : endTr;

        while (table = _domUtilsDomExtend2['default'].getParentByFilter(target, function (dom) {
            return _domUtilsDomExtend2['default'].hasClass(dom, _commonConst2['default'].CLASS.TABLE_CONTAINER);
        }, true)) {
            if (startTr) {
                target = _domUtilsDomExtend2['default'].getNextNode(table, false, end);
            } else {
                target = _domUtilsDomExtend2['default'].getPreviousNode(table, false, start);
            }
        }

        if (startTr) {
            start = target ? target : end;
            startOffset = 0;
        } else {
            end = target ? target : start;
            endOffset = _domUtilsDomExtend2['default'].getDomEndOffset(end);
        }

        if (startTr) {
            _rangeUtilsRangeExtend2['default'].setRange(end, endOffset, start, startOffset);
        } else {
            _rangeUtilsRangeExtend2['default'].setRange(start, startOffset, end, endOffset);
        }
    },
    /**
     * 修正 table 宽度
     * @param table
     */
    fixTableWidth: function fixTableWidth(table) {
        if (!table) {
            return;
        }
        var rows = table.rows,
            i,
            cell,
            w,
            tableWidth = 0;
        for (i = 0; i < rows[0].cells.length; i++) {
            cell = rows[0].cells[i];
            w = tableUtils.getCellWidth(cell);
            tableWidth += w;
        }
        table.style.width = tableWidth + 'px';
    },
    /**
     * 获取 选中区域内综合的单元格对齐方式
     * @param grid
     * @param range
     * @returns {*}
     */
    getAlign: function getAlign(grid, range) {
        if (!grid || !range) {
            return false;
        }
        var align,
            valign,
            cell,
            result = {
            align: '',
            valign: ''
        };
        tableUtils.eachRange(grid, range, function (cellData) {
            cell = cellData.cell;
            if (!cellData.fake) {
                align = cell.align.toLowerCase();
                valign = cell.vAlign.toLowerCase();
            }

            if (result.align === '') {
                result.align = align;
                result.valign = valign;
            }

            if (result.align !== null) {
                result.align = result.align === align ? align : null;
            }
            if (result.valign !== null) {
                result.valign = result.valign === valign ? valign : null;
            }

            return result.align !== null || result.valign !== null;
        });

        return result;
    },
    /**
     * 获取单元格宽度
     * @param cell
     * @returns {Number}
     */
    getCellWidth: function getCellWidth(cell) {
        return parseInt(cell.style.width || cell.offsetWidth, 10);
    },
    /**
     * 根据 单元格 dom 获取 grid 内对应的 data 数据
     * @param grid
     * @param cell
     * @returns {*}
     */
    getCellData: function getCellData(grid, cell) {
        if (!grid || !cell) {
            return null;
        }
        var i, j, g;
        for (i = 0; i < grid.length; i++) {
            for (j = 0; j < grid[i].length; j++) {
                g = grid[i][j];
                if (g.cell === cell) {
                    return g;
                }
            }
        }
        return null;
    },
    /**
     * 根据 rang 范围 获取 单元格的 data 列表
     * @param grid
     * @param range
     * @returns {Array}
     */
    getCellsByRange: function getCellsByRange(grid, range) {
        var cellList = [];
        if (!grid || !range) {
            return cellList;
        }
        tableUtils.eachRange(grid, range, function (cellData) {
            if (!cellData.fake) {
                cellList.push(cellData.cell);
            }
        });
        return cellList;
    },
    /**
     * 根据 target 目标 dom 判断是否处于 table 容器内且 在 table 之外
     * @param target
     * @returns {null}
     */
    getContianerExcludeTable: function getContianerExcludeTable(target) {
        var cell = _domUtilsDomExtend2['default'].getParentByTagName(target, ['th', 'td'], true, null);
        var tableContainer = !cell ? _domUtilsDomExtend2['default'].getParentByFilter(target, function (dom) {
            return _domUtilsDomExtend2['default'].hasClass(dom, _commonConst2['default'].CLASS.TABLE_CONTAINER);
        }, true) : null;
        return tableContainer;
    },
    /**
     * 从 cell 集合中遍历获取 cell 内的叶子节点集合
     * @param cellList
     * @returns {Array}
     */
    getDomsByCellList: function getDomsByCellList(cellList) {
        var i,
            j,
            cell,
            tmpList,
            domList = [];
        if (!cellList) {
            return domList;
        }
        for (i = 0, j = cellList.length; i < j; i++) {
            cell = cellList[i];
            tmpList = _domUtilsDomExtend2['default'].getDomListA2B({
                startDom: cell.firstChild,
                startOffset: 0,
                endDom: cell.lastChild,
                endOffset: 1,
                noSplit: true
            });
            domList = domList.concat(tmpList.list);
        }
        return domList;
    },
    /**
     * 在表格内根据指定单元格 获取 下一个 单元格，到达最后一列时，自动从下一行查找
     * @param cell
     * @returns {*}
     */
    getNextCellInTable: function getNextCellInTable(cell) {
        var nextCell = cell.nextElementSibling;
        if (nextCell) {
            return nextCell;
        }
        var tr = cell.parentNode.nextElementSibling;
        while (tr) {
            if (tr.cells.length > 0) {
                return tr.cells[0];
            }
            tr = tr.nextElementSibling;
        }
        return null;
    },
    /**
     * 在一行内 根据列数获取下一个单元格
     * @param gridRow
     * @param col
     * @returns {*}
     */
    getNextCellDataInRow: function getNextCellDataInRow(gridRow, col) {
        if (!gridRow) {
            return null;
        }
        var i;
        for (i = col; i < gridRow.length; i++) {
            if (!gridRow[i].fake) {
                return gridRow[i];
            }
        }
        return null;
    },
    /**
     * 根据 mouse 相关事件，获取 对应的 坐标位置
     * @param e
     * @param table
     * @returns {{clientX: *, clientY: *}}
     */
    getMousePosition: function getMousePosition(e, table) {
        var eventClient = _commonUtils2['default'].getEventClientPos(e);
        if (!table) {
            table = e.target ? _domUtilsDomExtend2['default'].getParentByTagName(e.target, 'table', false, null) : null;
        }
        var clientX = eventClient.x + _commonEnv2['default'].doc.body.scrollLeft + (table ? table.parentNode.scrollLeft : 0);
        var clientY = eventClient.y + _commonEnv2['default'].doc.body.scrollTop + (table ? table.parentNode.scrollTop : 0);
        return {
            x: clientX,
            y: clientY
        };
    },
    /**
     * 在一行内 根据列数获取上一个单元格
     * @param gridRow
     * @param col
     * @returns {*}
     */
    getPreviousCellDataInRow: function getPreviousCellDataInRow(gridRow, col) {
        if (!gridRow) {
            return null;
        }
        var i;
        for (i = col; i >= 0; i--) {
            if (!gridRow[i].fake) {
                return gridRow[i];
            }
        }
        return null;
    },
    /**
     * 根据 节点的 cellData 获取单元格所占面积
     * @param cellData
     * @returns {*}
     */
    getRangeByCellData: function getRangeByCellData(cellData) {
        if (!cellData) {
            return {
                minX: 0,
                minY: 0,
                maxX: 0,
                maxY: 0
            };
        }
        return {
            minX: cellData.x_src,
            minY: cellData.y_src,
            maxX: cellData.x_src + cellData.cell.colSpan - 1,
            maxY: cellData.y_src + cellData.cell.rowSpan - 1
        };
    },
    /**
     * 根据起始单元格的 data 数据 获取 grid 中的 range
     * @param grid
     * @param startData
     * @param endData
     * @returns {*}
     */
    getRangeByCellsData: function getRangeByCellsData(grid, startData, endData) {
        if (!grid || !startData || !endData) {
            return null;
        }

        var startRange = tableUtils.getRangeByCellData(startData);
        if (startData.cell === endData.cell) {
            return startRange;
        }
        var endRange = tableUtils.getRangeByCellData(endData);

        var minX = Math.min(startRange.minX, endRange.minX),
            minY = Math.min(startRange.minY, endRange.minY),
            maxX = Math.max(startRange.maxX, endRange.maxX),
            maxY = Math.max(startRange.maxY, endRange.maxY),
            _minX,
            _minY,
            _maxX,
            _maxY;

        var x,
            y,
            g,
            gRange,
            k,
            cellMap = {},
            changeRange = true;

        // console.log(minX + ',' + minY + ' - ' + maxX + ',' + maxY);
        while (changeRange) {
            changeRange = false;
            _minX = minX;
            _minY = minY;
            _maxX = maxX;
            _maxY = maxY;
            for (y = minY; y <= maxY; y++) {
                for (x = minX; x <= maxX; x++) {
                    // console.log('['+x+','+y+']' +minX + ',' + minY + ' - ' + maxX + ',' + maxY);
                    //遍历范围时，只需要寻找边缘的 Cell 即可
                    if (y > minY && y < maxY && x < maxX - 1) {
                        x = maxX - 1;
                        continue;
                    }

                    g = grid[y][x];
                    k = g.x_src + '_' + g.y_src;
                    if (cellMap[k]) {
                        //如果该 Cell 已经被计算过，则不需要重新计算
                        continue;
                    }

                    gRange = tableUtils.getRangeByCellData(g);
                    minX = Math.min(minX, gRange.minX);
                    minY = Math.min(minY, gRange.minY);
                    maxX = Math.max(maxX, gRange.maxX);
                    maxY = Math.max(maxY, gRange.maxY);

                    if (minX !== _minX || minY !== _minY || maxX !== _maxX || maxY !== _maxY) {
                        changeRange = true;
                        break;
                    }
                }
                if (changeRange) {
                    break;
                }
            }
        }

        return {
            minX: minX,
            minY: minY,
            maxX: maxX,
            maxY: maxY
        };
    },
    /**
     * 根据 表格 获取 grid
     * @param table
     * @returns {*}
     */
    getTableGrid: function getTableGrid(table) {
        if (!table || !_domUtilsDomExtend2['default'].isTag(table, 'table')) {
            return null;
        }
        var grid = [];
        var c, r, rows, row, cells, cell, colSpan, rowSpan, i, j, x, y, x_src, y_src, startX;

        rows = table.rows;
        for (r = 0; r < rows.length; r++) {
            row = rows[r];
            cells = row.cells;

            if (!grid[r]) {
                grid[r] = [];
            }
            for (c = 0; c < cells.length; c++) {
                cell = cells[c];
                colSpan = cell.colSpan;
                rowSpan = cell.rowSpan;

                startX = getX(c, r);
                for (i = 0; i < rowSpan; i++) {
                    if (!grid[r + i]) {
                        grid[r + i] = [];
                    }
                    for (j = 0; j < colSpan; j++) {
                        y = r + i;
                        x = getX(startX + j, y);
                        if (i == 0 && j == 0) {
                            x_src = x;
                            y_src = y;
                        }
                        grid[y][x] = {
                            cell: cell,
                            x: x,
                            y: y,
                            x_src: x_src,
                            y_src: y_src,
                            fake: i > 0 || j > 0
                        };
                    }
                }
            }
        }

        return grid;

        function getX(index, y) {
            while (grid[y][index]) {
                index++;
            }
            return index;
        }
    },
    /**
     * 分析 并处理 剪切板内得到的 html 代码
     * @param html
     * @returns {{isTable: boolean, pasteDom: *}}
     */
    getTemplateByHtmlForPaste: function getTemplateByHtmlForPaste(html) {
        var pasteTables,
            pasteTable,
            pasteIsTable = false,
            pasteDom,
            i,
            j,
            template = _commonEnv2['default'].doc.createElement('div');

        //excel 复制时， </html>后面有乱码，需要过滤
        if (html.indexOf('</html>') > -1) {
            html = html.substr(0, html.indexOf('</html>') + 7);
        }

        template.innerHTML = html;
        //清理无效dom
        _domUtilsDomExtend2['default'].childNodesFilter(template);

        pasteTables = template.querySelectorAll('table');
        if (pasteTables.length == 1) {
            pasteTable = pasteTables[0];
            pasteTable.parentNode.removeChild(pasteTable);
            if (_domUtilsDomExtend2['default'].isEmptyDom(template)) {
                pasteIsTable = true;
                pasteDom = pasteTable;
            } else {
                //如果不是单一表格，恢复 innerHTML 便于后面标准处理
                template.innerHTML = html;
            }
        }

        if (!pasteIsTable) {
            pasteTables = template.querySelectorAll('table');
            //表格内 禁止粘贴表格，所以需要把表格全部变为 text
            for (i = pasteTables.length - 1; i >= 0; i--) {
                pasteTable = pasteTables[i];
                _domUtilsDomExtend2['default'].before(pasteTable, _commonEnv2['default'].doc.createTextNode(pasteTable.innerText));
                pasteTable.parentNode.removeChild(pasteTable);
            }
            //清理 template 内的多余 nodeType
            for (i = template.childNodes.length - 1; i >= 0; i--) {
                j = template.childNodes[i];
                if (j.nodeType !== 1 && j.nodeType !== 3 && _domUtilsDomExtend2['default'].isEmptyDom(j)) {
                    template.removeChild(j);
                }
            }
            pasteDom = template;
        }
        return {
            isTable: pasteIsTable,
            pasteDom: pasteDom
        };
    },
    /**
     * 分析 并处理 剪切板内得到的 text 代码
     * @param txt
     * @returns {{isTable: boolean, pasteDom: Element}}
     */
    getTemplateByTxtForPaste: function getTemplateByTxtForPaste(txt) {
        txt = (txt || '').trim();
        var rows = txt.split('\n'),
            x,
            y,
            cols,
            table = _commonEnv2['default'].doc.createElement('table'),
            tbody = _commonEnv2['default'].doc.createElement('tbody'),
            tr,
            td,
            maxX = 0;

        table.appendChild(tbody);
        for (y = 0; y < rows.length; y++) {
            cols = rows[y].split('\t');
            tr = _commonEnv2['default'].doc.createElement('tr');
            for (x = 0; x < cols.length; x++) {
                td = tableUtils.createCell();
                if (cols[x]) {
                    td.innerHTML = '';
                    td.appendChild(_commonEnv2['default'].doc.createTextNode(cols[x]));
                }
                tr.appendChild(td);
            }
            maxX = Math.max(maxX, tr.cells.length);
            tbody.appendChild(tr);
        }

        //避免 table 列数不一致
        rows = table.rows;
        for (y = 0; y < rows.length; y++) {
            tr = rows[y];
            cols = tr.cells;
            for (x = cols.length; x < maxX; x++) {
                tr.appendChild(tableUtils.createCell());
            }
        }

        return {
            isTable: true,
            pasteDom: table
        };
    },
    /**
     * 初始化 表格 样式
     * @param table
     */
    initTable: function initTable(table) {
        var i,
            j,
            cell,
            needInit = false;
        if (table.style.width.indexOf('%') > -1) {
            needInit = true;
        } else {
            for (j = table.rows[0].cells.length - 1; j >= 0; j--) {
                cell = table.rows[0].cells[j];
                if (cell.style.width.indexOf('%') > -1) {
                    needInit = true;
                }
            }
        }
        if (!needInit) {
            return;
        }

        for (i = table.rows.length - 1; i >= 0; i--) {
            for (j = table.rows[i].cells.length - 1; j >= 0; j--) {
                cell = table.rows[i].cells[j];
                if (cell.style.width.indexOf('%') > -1) {
                    cell.style.width = cell.offsetWidth + 'px';
                }
            }
        }
        table.style.width = table.offsetWidth + 'px';
    },
    /**
     * 检查 并 初始化表格容器
     * @param _table
     */
    initTableContainer: function initTableContainer(_table) {
        var tableList = _table ? [_table] : _commonEnv2['default'].doc.querySelectorAll('table'),
            table,
            container,
            tableBody,
            i,
            j;

        for (i = 0, j = tableList.length; i < j; i++) {
            table = tableList[i];
            tableBody = checkParent(table, function (parent) {
                return _domUtilsDomExtend2['default'].hasClass(parent, _commonConst2['default'].CLASS.TABLE_BODY);
            });
            container = checkParent(tableBody, function (parent) {
                return _domUtilsDomExtend2['default'].hasClass(parent, _commonConst2['default'].CLASS.TABLE_CONTAINER);
            });

            _domUtilsDomExtend2['default'].addClass(container, _commonConst2['default'].CLASS.TABLE_CONTAINER);
            //避免 编辑、阅读状态切换时， 表格位置闪动，所以做成 inline 模式
            _domUtilsDomExtend2['default'].css(container, {
                position: 'relative',
                padding: '15px 0 5px'
            });
            _domUtilsDomExtend2['default'].addClass(tableBody, _commonConst2['default'].CLASS.TABLE_BODY);
            _domUtilsDomExtend2['default'].removeClass(tableBody, _commonConst2['default'].CLASS.TABLE_MOVING);
        }

        function checkParent(obj, filter) {
            var parent = obj.parentNode;
            if (!filter(parent)) {
                parent = _commonEnv2['default'].doc.createElement('div');
                _domUtilsDomExtend2['default'].before(obj, parent);
                parent.appendChild(obj);
            }
            return parent;
        }
    },
    /**
     * 在指定的位置插入列
     * @param grid
     * @param col
     */
    insertCol: function insertCol(grid, col) {
        if (!grid) {
            return;
        }
        col = col || 0;
        var y, gRow, g, cell, newCell, nextCellData;
        var table = _domUtilsDomExtend2['default'].getParentByTagName(grid[0][0].cell, 'table', false, null),
            rows = table.rows,
            lastCell = null;
        for (y = 0; y < grid.length; y++) {
            gRow = grid[y];

            if (gRow.length > col) {
                g = grid[y][col];
                cell = g.cell;
            } else {
                g = null;
                cell = null;
            }

            if (cell && cell !== lastCell && g.x_src < col) {
                //cell.colSpan > 1
                g.cell.colSpan++;

                // 需要调整 style
                g.cell.style.width = tableUtils.getCellWidth(g.cell) + _commonEnv2['default'].options.table.colWidth + 'px';
            } else if (!cell || cell && g.x_src == col) {

                newCell = tableUtils.createCell(_commonEnv2['default'].options.table.colWidth);
                if (cell && g.y_src < g.y) {
                    //cell.rowSpan > 1
                    nextCellData = tableUtils.getNextCellDataInRow(grid[y], col);
                    rows[y].insertBefore(newCell, nextCellData ? nextCellData.cell : null);
                } else {
                    rows[y].insertBefore(newCell, cell);
                }
            }
            lastCell = g ? g.cell : null;
        }

        tableUtils.fixTableWidth(table);
    },
    /**
     * 在指定的位置插入行
     * @param grid
     * @param row
     */
    insertRow: function insertRow(grid, row) {
        if (!grid) {
            return;
        }
        row = row || 0;
        var x, g, newCell;
        var table = _domUtilsDomExtend2['default'].getParentByTagName(grid[0][0].cell, 'table', false, null),
            tr = _commonEnv2['default'].doc.createElement('tr');
        var gRow = grid[grid.length > row ? row : grid.length - 1];
        for (x = 0; x < gRow.length; x++) {
            g = gRow[x];

            if (grid.length > row && g.y_src < g.y && g.x_src == g.x) {
                //cell.rowSpan > 1
                g.cell.rowSpan++;
                // TODO 需要调整 style( height)
            } else if (grid.length <= row || g.y_src == g.y) {
                    newCell = tableUtils.cloneCell(g.cell, true);
                    if (g.cell.colSpan > 1) {
                        newCell.style.width = g.cell.offsetWidth / g.cell.colSpan + 'px';
                    }
                    tr.appendChild(newCell);
                }
        }

        var target = gRow[0].cell.parentElement,
            parent = target.parentElement;
        if (grid.length <= row) {
            target = null;
        }
        parent.insertBefore(tr, target);
    },
    /**
     * 将指定的单元格范围进行合并
     * @param grid
     * @param range
     * @returns {*}
     */
    mergeCell: function mergeCell(grid, range) {
        if (!tableUtils.canMerge(grid, range)) {
            return null;
        }

        var dy = range.maxY - range.minY + 1,
            dx = range.maxX - range.minX + 1;

        var target = grid[range.minY][range.minX].cell;
        var temp = _commonEnv2['default'].doc.createElement('div');
        tableUtils.eachRange(grid, range, function (cellData) {
            if (!cellData.fake && cellData.cell != target) {
                if (!_domUtilsDomExtend2['default'].isEmptyDom(cellData.cell)) {
                    if (temp.lastChild) {
                        temp.appendChild(_commonEnv2['default'].doc.createElement('br'));
                    }
                    while (cellData.cell.firstChild) {
                        temp.appendChild(cellData.cell.firstChild);
                    }
                }
                cellData.cell.parentNode.removeChild(cellData.cell);
            }
        });
        while (temp.firstChild) {
            target.appendChild(temp.firstChild);
        }
        target.rowSpan = dy;
        target.colSpan = dx;
        return target;
    },
    /**
     * 设置单元格对齐方式
     * @param grid
     * @param range
     * @param _alignType
     */
    setCellAlign: function setCellAlign(grid, range, _alignType) {
        if (!grid || !range) {
            return;
        }

        var alignType = {};
        if (_alignType.align != null) {
            alignType.align = _alignType.align || 'left';
        }
        if (_alignType.valign != null) {
            alignType.valign = _alignType.valign || 'middle';
        }

        tableUtils.eachRange(grid, range, function (cellData) {
            if (!cellData.fake) {
                if (alignType.align) {
                    _domUtilsDomExtend2['default'].css(cellData.cell, { 'text-align': '' });
                }
                if (alignType.valign) {
                    _domUtilsDomExtend2['default'].css(cellData.cell, { 'text-valign': '' });
                }
                _domUtilsDomExtend2['default'].attr(cellData.cell, alignType);
            }
        });
    },
    /**
     * 设置单元格背景颜色
     * @param grid
     * @param range
     * @param bgColor
     */
    setCellBg: function setCellBg(grid, range, bgColor) {
        if (!grid || !range) {
            return;
        }

        bgColor = bgColor || '';
        if (bgColor.toLowerCase() === 'transparent') {
            bgColor = '';
        }

        tableUtils.eachRange(grid, range, function (cellData) {
            if (!cellData.fake) {
                _domUtilsDomExtend2['default'].css(cellData.cell, {
                    'background-color': bgColor
                });
            }
        });
    },
    /**
     * 设置列宽
     * @param table
     * @param grid
     * @param col
     * @param dx
     */
    setColWidth: function setColWidth(table, grid, col, dx) {
        dx = fixDx();
        var tableWidth = table.offsetWidth + dx;
        var i,
            j,
            g,
            key,
            cells = [],
            cellMap = {};
        for (i = 0, j = grid.length; i < j; i++) {
            g = grid[i][col];
            key = getKey(g);
            if (!cellMap[key]) {
                cellMap[key] = g.cell.offsetWidth + dx;
                cells.push(g);
            }
        }
        table.style.width = tableWidth + 'px';
        for (i = 0, j = cells.length; i < j; i++) {
            g = cells[i];
            g.cell.style.width = cellMap[getKey(g)] + 'px';
        }

        function getKey(g) {
            return g.x_src + '_' + g.y_src;
        }

        function fixDx() {
            var y,
                g,
                cell,
                maxDx = dx,
                tmpDx;
            for (y = 0; y < grid.length; y++) {
                g = grid[y][col];
                tmpDx = _commonEnv2['default'].options.table.colWidthMin - g.cell.offsetWidth;
                if (g.cell.colSpan == 1) {
                    maxDx = tmpDx;
                    cell = g.cell;
                    break;
                }
                if (maxDx < tmpDx) {
                    maxDx = tmpDx;
                    cell = g.cell;
                }
            }

            if (dx < maxDx) {
                return maxDx;
            } else {
                return dx;
            }
        }
    },
    /**
     * 设置行高
     * @param table
     * @param grid
     * @param row
     * @param dy
     */
    setRowHeight: function setRowHeight(table, grid, row, dy) {
        var x,
            g,
            cell,
            maxDy = dy,
            tmpDy;
        for (x = 0; x < grid[row].length; x++) {
            g = grid[row][x];
            tmpDy = _commonEnv2['default'].options.table.rowHeightMin - g.cell.offsetHeight;
            if (g.cell.rowSpan == 1) {
                maxDy = tmpDy;
                cell = g.cell;
                break;
            }
            if (maxDy < tmpDy) {
                maxDy = tmpDy;
                cell = g.cell;
            }
        }

        if (cell) {
            if (dy < maxDy) {
                cell.parentNode.style.height = _commonEnv2['default'].options.table.rowHeightMin + 'px';
            } else {
                cell.parentNode.style.height = g.cell.offsetHeight + dy + 'px';
            }
        }
    },
    /**
     * 拆分单元格
     * @param table
     * @param grid
     * @param range
     * @returns {*}
     */
    splitCell: function splitCell(table, grid, range) {
        var x, y, g, key, dx, dy;
        var splitMap = tableUtils.canSplit(grid, range);

        if (!splitMap) {
            return null;
        }
        var item, nextCell, newCell;
        for (key in splitMap) {
            if (splitMap.hasOwnProperty(key)) {
                g = splitMap[key];
                dy = g.cell.rowSpan;
                dx = g.cell.colSpan;
                for (y = g.y_src; y < g.y_src + dy; y++) {
                    for (x = g.x_src; x < g.x_src + dx; x++) {
                        item = grid[y][x];
                        if (item.fake) {
                            nextCell = tableUtils.getNextCellDataInRow(grid[y], x);
                            nextCell = nextCell ? nextCell.cell : null;
                            newCell = tableUtils.cloneCell(item.cell, true);
                            table.rows[y].insertBefore(newCell, nextCell);
                            item.fake = false;
                            item.cell = newCell;
                            item.y_src = y;
                            item.x_src = x;
                        } else {
                            item.cell.rowSpan = 1;
                            item.cell.colSpan = 1;
                        }

                        //TODO 需要多做测试检测这样是否可行
                        item.cell.style.width = '';
                    }
                }
            }
        }
        return range;
    }
};

exports['default'] = tableUtils;
module.exports = exports['default'];

},{"../rangeUtils/rangeExtend":36,"./../common/const":13,"./../common/env":15,"./../common/utils":19,"./../domUtils/domExtend":24}],42:[function(require,module,exports){
/*
 表格选择区域 控制
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonUtils = require('../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _commonHistoryUtils = require('../common/historyUtils');

var _commonHistoryUtils2 = _interopRequireDefault(_commonHistoryUtils);

var _tableUtils = require('./tableUtils');

var _tableUtils2 = _interopRequireDefault(_tableUtils);

var _domUtilsDomExtend = require('../domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

var _rangeUtilsRangeExtend = require('../rangeUtils/rangeExtend');

var _rangeUtilsRangeExtend2 = _interopRequireDefault(_rangeUtilsRangeExtend);

//import wizStyle from '../common/wizStyle';

var updateRenderTimer, updateRenderTimes, domModifiedTimer;

var zone = {
    active: false,
    table: null,
    start: null,
    end: null,
    range: null,
    grid: null
};
function initZone(table) {
    zone.table = table;
    zone.grid = _tableUtils2['default'].getTableGrid(zone.table);
}

function checkPageFirst(checkFirst, clientY) {
    var isFirst = false,
        isLast = false,
        offset,
        tableContainer;
    var obj = checkFirst ? _domUtilsDomExtend2['default'].getFirstDeepChild(_commonEnv2['default'].doc.body) : _domUtilsDomExtend2['default'].getLastDeepChild(_commonEnv2['default'].doc.body);
    while (obj && !_domUtilsDomExtend2['default'].canEdit(obj)) {
        obj = checkFirst ? _domUtilsDomExtend2['default'].getNextNodeCanEdit(obj, false) : _domUtilsDomExtend2['default'].getPreviousNodeCanEdit(obj, false);;
    }
    if (obj) {
        if (obj.nodeType == 3) {
            obj = obj.parentNode;
        }
        offset = _domUtilsDomExtend2['default'].getOffset(obj);
        tableContainer = _domUtilsDomExtend2['default'].getParentByFilter(obj, function (obj) {
            return _domUtilsDomExtend2['default'].hasClass(obj, _commonConst2['default'].CLASS.TABLE_CONTAINER);
        }, true);
        if (checkFirst && clientY < offset.top && tableContainer) {
            isFirst = true;
        } else if (!checkFirst && clientY > offset.top + obj.offsetHeight && tableContainer) {
            isLast = true;
        } else {
            obj = null;
        }
    }
    return {
        container: tableContainer,
        isFirst: isFirst,
        isLast: isLast
    };
}

function clearSelectedCell() {
    if (!zone.table) {
        return;
    }
    var cells = zone.table.getElementsByClassName(_commonConst2['default'].CLASS.SELECTED_CELL);
    var i;
    for (i = cells.length - 1; i >= 0; i--) {
        _domUtilsDomExtend2['default'].removeClass(cells[i], _commonConst2['default'].CLASS.SELECTED_CELL);
    }
}

function getCellsDataByRange() {
    if (!zone.grid || !zone.range) {
        return null;
    }
    var cells = [];
    _tableUtils2['default'].eachRange(zone.grid, zone.range, function (cellData) {
        if (!cellData.fake) {
            cells.push(cellData);
        }
    });
    return cells;
}
function getDomById(parent, id, tagName) {
    var dom = parent.querySelector('#' + id);
    if (!dom) {
        dom = _commonEnv2['default'].doc.createElement(tagName);
        dom.id = id;
        parent.appendChild(dom);
    }
    return dom;
}
function hasMergeCell() {
    if (!zone.grid || !zone.range) {
        return false;
    }
    var hasMerge = false;
    _tableUtils2['default'].eachRange(zone.grid, zone.range, function (cellData) {
        hasMerge = cellData.fake;
        return !hasMerge;
    });
    return false;
}
function isSingleCell() {
    if (!zone.grid || !zone.range) {
        return false;
    }
    var cellA = zone.grid[zone.range.minY][zone.range.minX],
        cellB = zone.grid[zone.range.maxY][zone.range.maxX],
        start = zone.start;
    return cellA.cell == cellB.cell && cellB.cell == start.cell;
}
function isStartFocus() {
    var range = _rangeUtilsRangeExtend2['default'].getRange();
    if (!range) {
        //手机端 失去焦点时，不能重新设置焦点，否则会导致无法关闭键盘
        return _commonEnv2['default'].client.type.isPhone || _commonEnv2['default'].client.type.isPad || !isSingleCell();
    }
    var start, end, endOffset;
    if (zone.grid && zone.start) {
        start = _domUtilsDomExtend2['default'].getParentByTagName(range.startContainer, ['th', 'td'], true, null);
        end = range.collapsed ? start : _domUtilsDomExtend2['default'].getParentByTagName(range.endContainer, ['th', 'td'], true, null);
    }

    //当前没有选中单元格  或  当前已选中该单元格时 true
    if (!zone.start || zone.start.cell == start && start == end) {
        return true;
    }
    if (!range.collapsed && zone.start.cell == start && start != end && range.endOffset === 0 && end == _tableUtils2['default'].getNextCellInTable(start)) {
        //如果单元格不是该行最后一个，全选时，endContainer 为下一个 td，且 endOffset 为 0
        //如果单元格是该行最后一个，全选时，endContainer 为下一行的第一个 td
        //这时候必须修正 range， 否则由于 amendUtils.splitAmendDomByRange 的修正，会导致输入的 第1个字符进入到下一个 td 内
        end = start.lastChild;
        endOffset = _domUtilsDomExtend2['default'].getDomEndOffset(end);
        //如果不延迟，会导致 选中的区域异常
        setTimeout(function () {
            _rangeUtilsRangeExtend2['default'].setRange(range.startContainer, range.startOffset, end, endOffset);
        }, 200);

        return true;
    }
    return false;
}
function selectCellsData(cellsData) {
    if (!cellsData) {
        return;
    }
    var i, j;
    for (i = 0, j = cellsData.length; i < j; i++) {
        _domUtilsDomExtend2['default'].addClass(cellsData[i].cell, _commonConst2['default'].CLASS.SELECTED_CELL);
    }
}

function colLineRender(x) {
    if (!zone.table) {
        return;
    }
    var rangeBorder = getRangeBorder();
    var minX = rangeBorder.colLine.minLeft;
    if (x < minX) {
        x = minX;
    }
    _domUtilsDomExtend2['default'].css(rangeBorder.colLine, {
        top: zone.table.offsetTop + 'px',
        left: x + 'px',
        height: zone.table.offsetHeight + 'px',
        display: 'block'
    }, false);

    rangeBorder.container.style.display = 'block';
}
function rowLineRender(y) {
    if (!zone.table) {
        return;
    }

    var rangeBorder = getRangeBorder();
    var minY = rangeBorder.rowLine.minTop;
    if (y < minY) {
        y = minY;
    }
    _domUtilsDomExtend2['default'].css(rangeBorder.rowLine, {
        left: zone.table.offsetLeft + 'px',
        top: y + 'px',
        width: zone.table.offsetWidth + 'px',
        display: 'block'
    }, false);

    rangeBorder.container.style.display = 'block';
}

function initTableContainer(rangeBorder) {
    _tableUtils2['default'].initTableContainer(zone.table);
    var tableBody = zone.table.parentNode;
    tableBody.appendChild(rangeBorder.container);
}

function rangeRender() {
    clearSelectedCell();
    selectCellsData(getCellsDataByRange());

    var rangeBorder = getRangeBorder();
    if (!zone.start || !zone.range) {
        rangeBorder.container.style.display = 'none';
        rangeBorder.start.dom.style.display = 'none';
        rangeBorder.range.dom.style.display = 'none';
        return;
    }
    // console.log(rangeBorder);
    initTableContainer(rangeBorder);

    var topSrc = _commonEnv2['default'].doc.body.clientTop;
    var leftSrc = _commonEnv2['default'].doc.body.clientLeft;
    var sLeft, sTop, sWidth, sHeight;
    var rLeft, rTop, rWidth, rHeight;

    var rangeCellStart = zone.start ? zone.start.cell : null;
    var rangeCell_A = zone.grid[zone.range.minY][zone.range.minX];
    var rangeCell_B = zone.grid[zone.range.maxY][zone.range.maxX];
    if (!rangeCell_A || !rangeCell_B) {
        return;
    }
    rangeCell_A = rangeCell_A.cell;
    rangeCell_B = rangeCell_B.cell;

    if (rangeCellStart) {
        sTop = topSrc + rangeCellStart.offsetTop;
        sLeft = leftSrc + rangeCellStart.offsetLeft;
        sWidth = rangeCellStart.offsetWidth;
        sHeight = rangeCellStart.offsetHeight;
    }

    rTop = topSrc + rangeCell_A.offsetTop;
    rLeft = leftSrc + rangeCell_A.offsetLeft;
    if (rangeCell_A == rangeCell_B) {
        rWidth = rangeCell_A.offsetWidth;
        rHeight = rangeCell_A.offsetHeight;
    } else {
        rWidth = rangeCell_B.offsetLeft + rangeCell_B.offsetWidth - rLeft;
        rHeight = rangeCell_B.offsetTop + rangeCell_B.offsetHeight - rTop;
    }

    _domUtilsDomExtend2['default'].css(rangeBorder.start.dom, {
        top: sTop + 'px',
        left: sLeft + 'px'
    }, false);
    _domUtilsDomExtend2['default'].css(rangeBorder.start.top, {
        width: sWidth + 'px'
    }, false);
    _domUtilsDomExtend2['default'].css(rangeBorder.start.left, {
        height: sHeight + 'px'
    }, false);
    _domUtilsDomExtend2['default'].css(rangeBorder.start.bottom, {
        top: sHeight - 1 + 'px',
        width: sWidth + 'px'
    }, false);
    _domUtilsDomExtend2['default'].css(rangeBorder.start.right, {
        left: sWidth - 1 + 'px',
        height: sHeight + 'px'
    }, false);
    _domUtilsDomExtend2['default'].css(rangeBorder.start.dot, {
        top: sHeight - 1 - 4 + 'px',
        left: sWidth - 1 - 4 + 'px'
    }, false);

    _domUtilsDomExtend2['default'].css(rangeBorder.range.dom, {
        top: rTop + 'px',
        left: rLeft + 'px'
    }, false);
    _domUtilsDomExtend2['default'].css(rangeBorder.range.top, {
        width: rWidth + 'px'
    }, false);
    _domUtilsDomExtend2['default'].css(rangeBorder.range.left, {
        height: rHeight + 'px'
    }, false);
    _domUtilsDomExtend2['default'].css(rangeBorder.range.bottom, {
        top: rHeight + 'px',
        width: rWidth + 'px'
    }, false);
    _domUtilsDomExtend2['default'].css(rangeBorder.range.right, {
        left: rWidth + 'px',
        height: rHeight + 'px'
    }, false);
    _domUtilsDomExtend2['default'].css(rangeBorder.range.dot, {
        top: rHeight - 4 + 'px',
        left: rWidth - 4 + 'px'
    }, false);

    rangeBorder.start.dom.style.display = 'block';
    if (isSingleCell()) {
        rangeBorder.start.dot.style.display = 'block';
        rangeBorder.range.dom.style.display = 'none';
    } else {
        rangeBorder.start.dot.style.display = 'none';
        rangeBorder.range.dom.style.display = 'block';
    }
    rangeBorder.container.style.display = 'block';

    //TODO 目前功能未制作，暂时隐藏，以后实现了再显示
    rangeBorder.start.dot.style.display = 'none';
    rangeBorder.range.dot.style.display = 'none';

    setStartRange();
}

function getRangeBorder() {
    var rangeBorder = {
        container: null,
        rowLine: null,
        colLine: null,
        start: {
            dom: null,
            top: null,
            right: null,
            bottom: null,
            left: null,
            dot: null
        },
        range: {
            dom: null,
            top: null,
            right: null,
            bottom: null,
            left: null,
            dot: null
        }
    };
    rangeBorder.container = getDomById(_commonEnv2['default'].doc.body, _commonConst2['default'].ID.TABLE_RANGE_BORDER, _commonConst2['default'].TAG.TMP_TAG);
    _domUtilsDomExtend2['default'].attr(rangeBorder.container, {
        contenteditable: 'false'
    });
    rangeBorder.colLine = getDomById(rangeBorder.container, _commonConst2['default'].ID.TABLE_COL_LINE, 'div');
    rangeBorder.rowLine = getDomById(rangeBorder.container, _commonConst2['default'].ID.TABLE_ROW_LINE, 'div');

    rangeBorder.start.dom = getDomById(rangeBorder.container, _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_start', 'div');
    rangeBorder.start.top = getDomById(rangeBorder.start.dom, _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_start_top', 'div');
    rangeBorder.start.right = getDomById(rangeBorder.start.dom, _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_start_right', 'div');
    rangeBorder.start.bottom = getDomById(rangeBorder.start.dom, _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_start_bottom', 'div');
    rangeBorder.start.left = getDomById(rangeBorder.start.dom, _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_start_left', 'div');
    rangeBorder.start.dot = getDomById(rangeBorder.start.dom, _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_start_dot', 'div');

    rangeBorder.range.dom = getDomById(rangeBorder.container, _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_range', 'div');
    rangeBorder.range.top = getDomById(rangeBorder.range.dom, _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_range_top', 'div');
    rangeBorder.range.right = getDomById(rangeBorder.range.dom, _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_range_right', 'div');
    rangeBorder.range.bottom = getDomById(rangeBorder.range.dom, _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_range_bottom', 'div');
    rangeBorder.range.left = getDomById(rangeBorder.range.dom, _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_range_left', 'div');
    rangeBorder.range.dot = getDomById(rangeBorder.range.dom, _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_range_dot', 'div');
    return rangeBorder;
}
function setStartRange() {
    var sel;
    //选中多个单元格时，取消光标
    if (zone.grid && zone.range && !isSingleCell()) {
        sel = _commonEnv2['default'].doc.getSelection();
        sel.empty();
        return;
    }
    if (!isStartFocus()) {
        _rangeUtilsRangeExtend2['default'].setRange(zone.start.cell, zone.start.cell.childNodes.length);
    }
}

var _event = {
    bind: function bind() {
        _event.unbind();
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_SELECT_CHANGE, _event.handler.onSelectionChange);
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.UPDATE_RENDER, _event.handler.updateRender);
        if (zone.table) {
            //单元格内插入图片时， 因为加载图片时长为知，触发 modified 的时候， 图片还未加载完毕，
            //但加载完毕后，肯定会触发 body 的 resize事件
            zone.table.addEventListener('DOMSubtreeModified', _event.handler.onDomModified);
            _commonEnv2['default'].doc.body.addEventListener('resize', _event.handler.onDomModified);
        }
    },
    unbind: function unbind() {
        var zone = tableZone.getZone();
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_SELECT_CHANGE, _event.handler.onSelectionChange);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.UPDATE_RENDER, _event.handler.updateRender);
        if (zone.table) {
            zone.table.removeEventListener('DOMSubtreeModified', _event.handler.onDomModified);
            _commonEnv2['default'].doc.body.removeEventListener('resize', _event.handler.onDomModified);
        }
    },
    bindStopSelectStart: function bindStopSelectStart() {
        _event.unbindStopSelectStart();
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_SELECT_START, _event.handler.onStopSelectStart);
    },
    unbindStopSelectStart: function unbindStopSelectStart() {
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_SELECT_START, _event.handler.onStopSelectStart);
    },
    bindDragLine: function bindDragLine() {
        _event.unbindDragLine();
        _event.bindStopSelectStart();
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_MOUSE_MOVE, _event.handler.onDragLineMove);
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_MOUSE_UP, _event.handler.onDragLineEnd);
    },
    unbindDragLine: function unbindDragLine() {
        _event.unbindStopSelectStart();
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_MOUSE_MOVE, _event.handler.onDragLineMove);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_MOUSE_UP, _event.handler.onDragLineEnd);
    },
    handler: {
        onDragLineMove: function onDragLineMove(e) {
            var rangeBorder = getRangeBorder();
            var pos = _tableUtils2['default'].getMousePosition(e, zone.table);
            if (rangeBorder.colLine.style.display == 'block') {
                colLineRender(pos.x - rangeBorder.colLine.startMouse + rangeBorder.colLine.startLine);
            } else {
                rowLineRender(pos.y - rangeBorder.rowLine.startMouse + rangeBorder.rowLine.startLine);
            }
        },
        onDragLineEnd: function onDragLineEnd(e) {
            _event.unbindDragLine();
            var rangeBorder = getRangeBorder();
            var pos = _tableUtils2['default'].getMousePosition(e, zone.table);
            var cellData;

            var isDragCol = rangeBorder.colLine.style.display == 'block';
            var isDragRow = rangeBorder.rowLine.style.display == 'block';

            rangeBorder.colLine.style.display = 'none';
            rangeBorder.rowLine.style.display = 'none';
            _commonHistoryUtils2['default'].saveSnap(false);
            if (isDragCol && rangeBorder.colLine.startMouse !== pos.x) {
                cellData = rangeBorder.colLine.cellData;
                if (cellData) {
                    _tableUtils2['default'].initTable(zone.table);
                    _tableUtils2['default'].setColWidth(zone.table, zone.grid, cellData.x, pos.x - rangeBorder.colLine.startMouse);
                }
            } else if (isDragRow && rangeBorder.rowLine.startMouse !== pos.y) {
                cellData = rangeBorder.rowLine.cellData;
                if (cellData) {
                    _tableUtils2['default'].initTable(zone.table);
                    _tableUtils2['default'].setRowHeight(zone.table, zone.grid, cellData.y, pos.y - rangeBorder.rowLine.startMouse);
                }
            }

            rangeBorder.colLine.cellData = null;
            rangeBorder.colLine.minLeft = null;
            rangeBorder.colLine.startLine = null;
            rangeBorder.colLine.startMouse = null;
            rangeBorder.rowLine.cellData = null;
            rangeBorder.rowLine.minTop = null;
            rangeBorder.rowLine.startLine = null;
            rangeBorder.rowLine.startMouse = null;

            rangeRender();
        },
        onSelectionChange: function onSelectionChange(e) {
            //当选中单元格时，不允许 选中 start 单元格以外的任何内容
            var sel = _commonEnv2['default'].doc.getSelection();
            if (!isStartFocus()) {
                sel.empty();
                // rangeUtils.setRange(zone.start.cell, zone.start.cell.childNodes.length);
                _commonUtils2['default'].stopEvent(e);
            }
        },
        onDomModified: function onDomModified(e) {
            var needAutoRetry = e && e.type == 'DOMSubtreeModified' && e.target.nodeType === 1 && e.target.querySelector('img');
            if (domModifiedTimer) {
                clearTimeout(domModifiedTimer);
            }
            domModifiedTimer = setTimeout(function () {
                _event.handler.updateRender(e, needAutoRetry);
            }, 100);
        },
        onStopSelectStart: function onStopSelectStart(e) {
            _commonUtils2['default'].stopEvent(e);
            return false;
        },
        updateRender: function updateRender(e, needAutoRetry) {
            updateRenderTimes = 0;
            autoUpdate(needAutoRetry);

            function autoUpdate(needAutoRetry) {
                //单元格内容变化时，必须重绘，保证 高亮边框的高度与表格一致
                rangeRender();
                //如果 变化的内容里面有 img，则需要延迟监听，等 img 渲染完毕
                if (needAutoRetry && updateRenderTimes < 60) {
                    if (updateRenderTimer) {
                        clearTimeout(updateRenderTimer);
                    }
                    updateRenderTimer = setTimeout(function () {
                        updateRenderTimes++;
                        autoUpdate(needAutoRetry);
                    }, 500);
                }
            }
        }
    }
};

var tableZone = {
    clear: function clear() {
        zone.active = false;
        zone.start = null;
        zone.end = null;
        zone.range = null;
        zone.grid = null;

        rangeRender();

        var rangeBorder = getRangeBorder();
        rangeBorder.colLine.style.display = 'none';
        rangeBorder.rowLine.style.display = 'none';

        //table 必须最后清空，因为还要清除 table 里面 cell 的选择状态
        zone.table = null;
        _event.unbind();
        return tableZone;
    },
    /**
     * 为防止笔记内只有一个表格时 无法在表格前后 或 多个表格之间输入内容
     */
    checkAndInsertEmptyLine: function checkAndInsertEmptyLine(e) {
        var touch = e.changedTouches ? e.changedTouches[0] : null,
            target = touch ? touch.target : e.target,
            eventClient = _commonUtils2['default'].getEventClientPos(e),
            clientY = _commonEnv2['default'].doc.body.scrollTop + eventClient.y;
        var dom,
            tableContainer,
            checkResult,
            isAfter = false,
            isBefore = false;

        if (target === _commonEnv2['default'].doc.body || target === _commonEnv2['default'].doc.body.parentNode) {
            if (target === _commonEnv2['default'].doc.body) {
                checkResult = checkPageFirst(true, clientY);
                isBefore = checkResult.isFirst;
                tableContainer = checkResult.container;
            }
            if (!isBefore) {
                checkResult = checkPageFirst(false, clientY);
                isAfter = checkResult.isLast;
                tableContainer = checkResult.container;
            }
        } else if (_domUtilsDomExtend2['default'].hasClass(target, _commonConst2['default'].CLASS.TABLE_CONTAINER) || _domUtilsDomExtend2['default'].hasClass(target, _commonConst2['default'].CLASS.TABLE_BODY)) {
            tableContainer = _domUtilsDomExtend2['default'].getParentByFilter(target, function (obj) {
                return _domUtilsDomExtend2['default'].hasClass(obj, _commonConst2['default'].CLASS.TABLE_CONTAINER);
            }, true);
            var offsetY = 0;
            if (tableContainer) {
                offsetY = clientY - _domUtilsDomExtend2['default'].getOffset(tableContainer).top;
            }
            if (tableContainer && offsetY < 15) {
                dom = _domUtilsDomExtend2['default'].getPreviousNodeCanEdit(target, false);
                if (!dom || _domUtilsDomExtend2['default'].getParentByFilter(dom, function (obj) {
                    return _domUtilsDomExtend2['default'].hasClass(obj, _commonConst2['default'].CLASS.TABLE_CONTAINER);
                }, true)) {
                    isBefore = true;
                }
            } else if (tableContainer && target.offsetHeight - offsetY < 15) {
                dom = _domUtilsDomExtend2['default'].getNextNodeCanEdit(target, false);
                if (!dom || _domUtilsDomExtend2['default'].getParentByFilter(dom, function (obj) {
                    return _domUtilsDomExtend2['default'].hasClass(obj, _commonConst2['default'].CLASS.TABLE_CONTAINER);
                }, true)) {
                    isAfter = true;
                }
            }
        }
        if (tableContainer && (isAfter || isBefore)) {
            tableZone.insertEmptyLine(tableContainer, isAfter);
        } else {
            dom = null;
        }
    },
    /**
     * 为 复制/剪切 操作，准备 fragment
     */
    getFragmentForCopy: function getFragmentForCopy() {
        var fragment = null;
        //无选中单元格时，不进行任何操作
        if (!zone.range) {
            return fragment;
        }

        var x,
            y,
            g,
            table = _commonEnv2['default'].doc.createElement('table'),
            tbody = _commonEnv2['default'].doc.createElement('tbody'),
            tr,
            td;

        table.appendChild(tbody);
        for (y = zone.range.minY; y <= zone.range.maxY; y++) {
            tr = _commonEnv2['default'].doc.createElement('tr');
            for (x = zone.range.minX; x <= zone.range.maxX; x++) {
                g = zone.grid[y][x];
                if (!g.fake) {
                    td = _tableUtils2['default'].cloneCell(g.cell, false);
                    if (tr.children.length > 0) {
                        //保证 复制的纯文本 有 列间隔
                        tr.appendChild(_commonEnv2['default'].doc.createTextNode('\t'));
                    }
                    tr.appendChild(td);
                }
            }
            //保证 复制的纯文本 有 行间隔
            tr.appendChild(_commonEnv2['default'].doc.createTextNode('\n'));
            tbody.appendChild(tr);
        }

        fragment = _commonEnv2['default'].doc.createElement('div');
        fragment.appendChild(table);
        return fragment;
    },
    getRangeBorder: getRangeBorder,
    getSelectedCells: function getSelectedCells() {
        return _tableUtils2['default'].getCellsByRange(zone.grid, zone.range);
    },
    getZone: function getZone() {
        return {
            active: zone.active,
            table: zone.table,
            start: zone.start,
            end: zone.end,
            range: zone.range,
            grid: zone.grid
        };
    },
    hasMergeCell: hasMergeCell,
    insertEmptyLine: function insertEmptyLine(tableContainer, after) {
        if (!tableContainer) {
            return;
        }
        var newLine = _commonEnv2['default'].doc.createElement('div');
        var dom = _commonEnv2['default'].doc.createElement('br');
        newLine.appendChild(dom);
        _domUtilsDomExtend2['default'].before(tableContainer, newLine, after);
        tableZone.clear();
        _rangeUtilsRangeExtend2['default'].setRange(dom, 0);
    },
    isRangeActiving: function isRangeActiving() {
        return zone.start && zone.active;
    },
    isSingleCell: isSingleCell,
    isZoneBorder: function isZoneBorder(e) {
        var obj = e.target,
            x = e.offsetX,
            y = e.offsetY,
            eventClient = _commonUtils2['default'].getEventClientPos(e);
        var isScroll,
            isBodyBorder = false,
            isBorder = false,
            isRight = false,
            isBottom = false,
            isContainer = false;

        var isDot = !!_domUtilsDomExtend2['default'].getParentByFilter(obj, function (dom) {
            return dom && dom.nodeType == 1 && (dom.id == _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_start_dot' || dom.id == _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_range_dot');
        }, true);

        if (!isDot) {
            isRight = !!_domUtilsDomExtend2['default'].getParentByFilter(obj, function (dom) {
                if (dom && dom.nodeType == 1 && (dom.id == _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_start_right' || dom.id == _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_range_right')) {
                    return true;
                }

                var minX, maxX;
                if (dom && dom.nodeType == 1 && _domUtilsDomExtend2['default'].isTag(dom, ['td', 'th'])) {
                    minX = dom.offsetWidth - 4;
                    maxX = dom.offsetWidth + 4;
                    return x >= minX && x <= maxX;
                }
                return false;
            }, true);
        }
        if (!isDot && !isRight) {
            isBottom = !!_domUtilsDomExtend2['default'].getParentByFilter(obj, function (dom) {
                if (dom && dom.nodeType == 1 && (dom.id == _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_start_bottom' || dom.id == _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_range_bottom')) {
                    return true;
                }

                var minY, maxY;
                if (dom && dom.nodeType == 1 && _domUtilsDomExtend2['default'].isTag(dom, ['td', 'th'])) {
                    minY = dom.offsetHeight - 4;
                    maxY = dom.offsetHeight + 4;
                    return y >= minY && y <= maxY;
                }
                return false;
            }, true);
        }
        if (!isBottom && !isDot && !isRight) {
            isBorder = !!_domUtilsDomExtend2['default'].getParentByFilter(obj, function (dom) {
                return dom && dom.nodeType == 1 && dom.id == _commonConst2['default'].ID.TABLE_RANGE_BORDER;
            }, true);
        }

        var bodyStyle, bodyLeft, bodyRight;
        if (!isBottom && !isDot && !isRight && !isBorder) {
            isContainer = !!_tableUtils2['default'].getContianerExcludeTable(obj);
            if (!isContainer && obj == _commonEnv2['default'].doc.body) {
                bodyStyle = _commonEnv2['default'].win.getComputedStyle(obj);
                bodyLeft = parseInt(bodyStyle.paddingLeft);
                bodyRight = parseInt(bodyStyle.paddingRight);
                isBodyBorder = eventClient.x <= bodyLeft || eventClient.x >= _commonEnv2['default'].doc.body.offsetWidth - bodyRight;
            }
        }

        //span 等 行级元素 clientWidth / clientHeight 为 0
        isScroll = (e.target.clientWidth > 0 && e.target.clientWidth < e.offsetX || e.target.clientHeight > 0 && e.target.clientHeight < e.offsetY) && (e.target.offsetWidth >= e.offsetX || e.target.offsetHeight >= e.offsetY);

        return {
            isBodyBorder: isBodyBorder,
            isBorder: isBorder,
            isBottom: isBottom,
            isContainer: isContainer,
            isDot: isDot,
            isRight: isRight,
            isScroll: isScroll
        };
    },
    modify: function modify(endCell) {
        if (!zone.active || !endCell) {
            return tableZone;
        }
        // console.log('modify');
        var table = _domUtilsDomExtend2['default'].getParentByTagName(endCell, ['table'], true, null);
        if (!table || table !== zone.table) {
            return tableZone;
        }
        var endCellData = _tableUtils2['default'].getCellData(zone.grid, endCell);
        zone.range = _tableUtils2['default'].getRangeByCellsData(zone.grid, zone.start, endCellData);
        zone.end = endCellData;
        rangeRender();

        var tableBody = _domUtilsDomExtend2['default'].getParentByFilter(zone.table, function (dom) {
            return _domUtilsDomExtend2['default'].hasClass(dom, _commonConst2['default'].CLASS.TABLE_BODY);
        }, false);
        _domUtilsDomExtend2['default'].addClass(tableBody, _commonConst2['default'].CLASS.TABLE_MOVING);

        return tableZone;
    },
    remove: function remove() {
        tableZone.clear();
        var rangeBorder = getRangeBorder(),
            parent;
        if (rangeBorder) {
            parent = rangeBorder.container.parentNode;
            if (parent) {
                parent.removeChild(rangeBorder.container);
            }
        }
    },
    setEnd: function setEnd(endCell, isForced) {
        // console.log('setEnd');
        if (isForced) {
            zone.active = true;
        }
        tableZone.modify(endCell);
        zone.active = false;

        setStartRange();
        _commonEnv2['default'].event.call(_commonConst2['default'].EVENT.ON_SELECT_CHANGE, null);

        var tableBody = _domUtilsDomExtend2['default'].getParentByFilter(zone.table, function (dom) {
            return _domUtilsDomExtend2['default'].hasClass(dom, _commonConst2['default'].CLASS.TABLE_BODY);
        }, false);
        _domUtilsDomExtend2['default'].removeClass(tableBody, _commonConst2['default'].CLASS.TABLE_MOVING);
        return tableZone;

        // console.log(zone);
    },
    setStart: function setStart(startCell, curX, curY) {
        // console.log('setStart');
        if (!startCell) {
            tableZone.clear();
            return tableZone;
        }
        var table = _domUtilsDomExtend2['default'].getParentByTagName(startCell, ['table'], true, null);
        if (!table) {
            //防止异常的 标签
            tableZone.clear();
            return tableZone;
        }
        if (table !== zone.table) {
            tableZone.clear();
            initZone(table);
        }
        zone.active = true;
        zone.end = null;
        zone.start = _tableUtils2['default'].getCellData(zone.grid, startCell);
        if (typeof curX !== 'undefined' && typeof curY !== 'undefined') {
            try {
                var tmp = zone.grid[curY][curX];
                if (tmp && tmp.cell == zone.start.cell) {
                    zone.start = tmp;
                }
            } catch (e) {}
        }
        zone.range = _tableUtils2['default'].getRangeByCellsData(zone.grid, zone.start, zone.start);
        rangeRender();
        _event.bind();
        return tableZone;
    },
    setStartRange: setStartRange,
    startDragColLine: function startDragColLine(cell, x) {
        var table, cellData;
        if (cell && cell.nodeType == 1 && cell.id == _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_start_right') {
            cellData = zone.start;
            cell = zone.start.cell;
            table = zone.table;
        } else if (cell && cell.nodeType == 1 && cell.id == _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_range_right') {
            cellData = zone.grid[zone.range.maxY][zone.range.maxX];
            cell = cellData.cell;
            table = zone.table;
        } else {
            cell = _domUtilsDomExtend2['default'].getParentByTagName(cell, ['th', 'td'], true, null);
            if (!cell) {
                return;
            }
            table = _domUtilsDomExtend2['default'].getParentByTagName(cell, ['table'], true, null);
            if (!table) {
                return;
            }

            if (table !== zone.table) {
                clearSelectedCell();
                tableZone.clear();
            }
            if (!zone.grid) {
                initZone(table);
            }
            cellData = _tableUtils2['default'].getCellData(zone.grid, cell);
        }

        //如果 cell 是合并的单元格，需要找到 cell 所占的最后一列
        var col = cellData.x,
            nextCellData;
        while (col + 1 < zone.grid[cellData.y].length) {
            col++;
            nextCellData = zone.grid[cellData.y][col];
            if (nextCellData.cell != cell) {
                break;
            }
            cellData = nextCellData;
        }

        var startLeft = cell.offsetLeft + cell.offsetWidth;
        var rangeBorder = getRangeBorder();
        initTableContainer(rangeBorder);
        rangeBorder.colLine.minLeft = table.offsetLeft;
        rangeBorder.colLine.startLine = startLeft;
        rangeBorder.colLine.startMouse = x;
        rangeBorder.colLine.cellData = cellData;
        colLineRender(startLeft);

        var sel = _commonEnv2['default'].doc.getSelection();
        sel.empty();
        _event.bindDragLine();
    },
    startDragRowLine: function startDragRowLine(cell, y) {
        var table, cellData;
        if (cell && cell.nodeType == 1 && cell.id == _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_start_bottom') {
            cellData = zone.start;
            cell = zone.start.cell;
            table = zone.table;
        } else if (cell && cell.nodeType == 1 && cell.id == _commonConst2['default'].ID.TABLE_RANGE_BORDER + '_range_bottom') {
            cellData = zone.grid[zone.range.maxY][zone.range.maxX];
            cell = cellData.cell;
            table = zone.table;
        } else {
            cell = _domUtilsDomExtend2['default'].getParentByTagName(cell, ['th', 'td'], true, null);
            if (!cell) {
                return;
            }
            table = _domUtilsDomExtend2['default'].getParentByTagName(cell, ['table'], true, null);
            if (!table) {
                return;
            }

            if (table !== zone.table) {
                clearSelectedCell();
                tableZone.clear();
            }
            if (!zone.grid) {
                initZone(table);
            }
            cellData = _tableUtils2['default'].getCellData(zone.grid, cell);
        }

        //如果 cell 是合并的单元格，需要找到 cell 所占的最后一行
        var row = cellData.y,
            nextCellData;
        while (row + 1 < zone.grid.length) {
            row++;
            nextCellData = zone.grid[row][cellData.x];
            if (nextCellData.cell != cell) {
                break;
            }
            cellData = nextCellData;
        }

        var startTop = cell.offsetTop + cell.offsetHeight;
        var rangeBorder = getRangeBorder();
        initTableContainer(rangeBorder);
        rangeBorder.rowLine.minTop = table.offsetTop;
        rangeBorder.rowLine.startLine = startTop;
        rangeBorder.rowLine.startMouse = y;
        rangeBorder.rowLine.cellData = cellData;
        rowLineRender(startTop);

        var sel = _commonEnv2['default'].doc.getSelection();
        sel.empty();
        _event.bindDragLine();
    },
    switchCell: function switchCell(target, direct) {
        if (!direct || !zone.start) {
            return null;
        }
        //目前不考虑 x、y 为任意值的情况， 只考虑移动一个单元格
        direct.x = !direct.x ? 0 : direct.x > 0 ? 1 : -1;
        direct.y = !direct.y ? 0 : direct.y > 0 ? 1 : -1;
        var x = target.x + direct.x;
        var y = target.y + direct.y;

        changeRowCheck();

        var cellData = target;
        while (y >= 0 && y < zone.grid.length && x >= 0 && x < zone.grid[y].length && cellData.cell == target.cell) {

            cellData = zone.grid[y][x];
            x += direct.x;
            y += direct.y;

            changeRowCheck();
        }

        return cellData;

        function changeRowCheck() {
            if (!!direct.canChangeRow && y >= 0 && y < zone.grid.length) {
                //允许折行
                if (x < 0) {
                    x = zone.grid[y].length - 1;
                    y -= 1;
                } else if (x >= zone.grid[y].length) {
                    x = 0;
                    y += 1;
                }
            }
        }
    },
    updateGrid: function updateGrid() {
        var rangeA, rangeB;
        if (zone.table) {
            if (zone.grid) {
                rangeA = zone.grid[zone.range.minY][zone.range.minX];
                rangeB = zone.grid[zone.range.maxY][zone.range.maxX];
            }
            initZone(zone.table);
            rangeA = _tableUtils2['default'].getCellData(zone.grid, rangeA.cell);
            rangeB = _tableUtils2['default'].getCellData(zone.grid, rangeB.cell);
            zone.range = _tableUtils2['default'].getRangeByCellsData(zone.grid, rangeA, rangeB);
            zone.start = _tableUtils2['default'].getCellData(zone.grid, zone.start.cell);
            if (zone.end) {
                zone.end = _tableUtils2['default'].getCellData(zone.grid, zone.end.cell);
            }
        }
        rangeRender();

        return tableZone;
        // console.log(zone);
    }
};

exports['default'] = tableZone;
module.exports = exports['default'];

},{"../common/const":13,"../common/env":15,"../common/historyUtils":16,"../common/utils":19,"../domUtils/domExtend":24,"../rangeUtils/rangeExtend":36,"./tableUtils":41}],43:[function(require,module,exports){
/**
 * todolist 操作核心包 core
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonWizStyle = require('../common/wizStyle');

var _commonWizStyle2 = _interopRequireDefault(_commonWizStyle);

var _commonUtils = require('../common/utils');

var _commonUtils2 = _interopRequireDefault(_commonUtils);

var _domUtilsDomExtend = require('../domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

var _rangeUtilsRangeExtend = require('../rangeUtils/rangeExtend');

var _rangeUtilsRangeExtend2 = _interopRequireDefault(_rangeUtilsRangeExtend);

var _todoRouteForClient = require('./todoRouteForClient');

var _todoRouteForClient2 = _interopRequireDefault(_todoRouteForClient);

var _todoUtils = require('./todoUtils');

var _todoUtils2 = _interopRequireDefault(_todoUtils);

var todoRoute = null;
var curTouchTarget = null;

var patchForReader = {
    curCheckbox: null,
    docLockChecked: false,
    modifiedIdList: {},
    htmlToSave: '',
    init: function init() {
        if (_commonEnv2['default'].readonly) {
            patchForReader.modifiedIdList = {};
        }
    },
    addModifiedId: function addModifiedId(obj) {
        if (!_commonEnv2['default'].readonly) {
            return;
        }
        var x = patchForReader.modifiedIdList[obj.id];
        if (x && x !== obj.checked) {
            delete patchForReader.modifiedIdList[obj.id];
        } else {
            patchForReader.modifiedIdList[obj.id] = obj.checked;
        }
    },
    getModifiedIdList: function getModifiedIdList() {
        var k,
            idList = [];
        for (k in patchForReader.modifiedIdList) {
            if (patchForReader.modifiedIdList.hasOwnProperty(k)) {
                idList.push({ id: k, checked: patchForReader.modifiedIdList[k] });
            }
        }
        return idList;
    },
    modifyDoc: function modifyDoc() {
        var html = '';

        var idList = patchForReader.getModifiedIdList();
        if (idList.length === 0) {
            return html;
        }

        html = todoRoute.getOriginalDoc();

        var iframe = _commonEnv2['default'].doc.getElementById(_commonConst2['default'].ID.IFRAME_FOR_SAVE);
        if (!iframe) {
            iframe = _commonEnv2['default'].doc.createElement('iframe');
            iframe.id = _commonConst2['default'].ID.IFRAME_FOR_SAVE;
            _commonEnv2['default'].doc.body.appendChild(iframe);
        }
        iframe.style.display = 'none';

        var _document = _commonEnv2['default'].doc,
            _win = _commonEnv2['default'].win,
            iframeDocument = iframe.contentDocument,
            isPersonal = todoRoute.isPersonalDocument(),
            i,
            id,
            checked,
            checkbox,
            main;

        iframeDocument.open("text/html", "replace");
        iframeDocument.write(html);
        iframeDocument.close();

        _commonEnv2['default'].doc = iframeDocument;
        _commonEnv2['default'].win = iframe.contentWindow;

        //在 iframe 内处理 html
        _todoUtils2['default'].oldPatch.fixOldTodo();
        for (i = idList.length - 1; i >= 0; i--) {
            id = idList[i].id;
            checked = idList[i].checked;
            checkbox = _commonEnv2['default'].doc.getElementById(id);
            if (checkbox) {
                main = _todoUtils2['default'].getMainFromChild(checkbox);
                _todoUtils2['default'].check(main, checked);
                if (!isPersonal) {
                    _todoUtils2['default'].addUserInfo(main, checked, id, todoRoute);
                }
            }
        }
        _todoUtils2['default'].checkTodoStyle(true);

        //获取处理后的 html
        html = _domUtilsDomExtend2['default'].getContentHtml();
        _commonEnv2['default'].doc = _document;
        _commonEnv2['default'].win = _win;

        _commonEnv2['default'].doc.body.removeChild(iframe);
        return html;
    }
};

function beforeCheckTodo(e) {
    if (!todoRoute.hasPermission()) {
        return null;
    }
    var checkbox = e.target;
    if (!_domUtilsDomExtend2['default'].hasClass(checkbox, _commonConst2['default'].CLASS.TODO_CHECKBOX)) {
        return null;
    }

    if (_commonEnv2['default'].readonly && !!patchForReader.curCheckbox) {
        return null;
    }
    if (!_commonEnv2['default'].readonly || patchForReader.docLockChecked) {
        checkTodo(checkbox, e);
    } else {
        patchForReader.curCheckbox = checkbox;
        todoRoute.checkDocLock("onCheckDocLock");
    }
}

function checkTodo(checkbox, e) {
    var result = _todoUtils2['default'].checkTodo(checkbox, todoRoute);
    if (result) {
        patchForReader.addModifiedId(result);
        if (e) {
            _commonUtils2['default'].stopEvent(e);
        }
    }
}

//TODO 所有配色 要考虑到 夜间模式
var _event = {
    bind: function bind() {
        _event.unbind();
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_SELECT_CHANGE, _event.handler.onSelectionChange);
        _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.AFTER_RESTORE_HISTORY, _event.handler.afterRestoreHistory);

        if (_commonEnv2['default'].client.type.isIOS || _commonEnv2['default'].client.type.isAndroid) {
            _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_TOUCH_END, _event.handler.onTouchEnd);
            _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_TOUCH_START, _event.handler.onTouchStart);
        } else {
            _commonEnv2['default'].event.add(_commonConst2['default'].EVENT.ON_CLICK, _event.handler.onClick);
        }
    },
    unbind: function unbind() {
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_CLICK, _event.handler.onClick);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_SELECT_CHANGE, _event.handler.onSelectionChange);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_TOUCH_END, _event.handler.onTouchEnd);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.ON_TOUCH_START, _event.handler.onTouchStart);
        _commonEnv2['default'].event.remove(_commonConst2['default'].EVENT.AFTER_RESTORE_HISTORY, _event.handler.afterRestoreHistory);
    },
    handler: {
        afterRestoreHistory: function afterRestoreHistory() {
            //恢复历史后，需要检查 todoList 的 style 样式
            _todoUtils2['default'].checkTodoStyle(false);
            _commonWizStyle2['default'].restoreUserAvatarStyle();
        },
        onClick: function onClick(e) {
            beforeCheckTodo(e);
        },
        onCheckDocLock: function onCheckDocLock(cancel, needCallAgain) {
            patchForReader.docLockChecked = !needCallAgain;
            if (!cancel) {
                checkTodo(patchForReader.curCheckbox);
            }
            patchForReader.curCheckbox = null;
        },
        onKeyDown: function onKeyDown(e) {
            if (!todoRoute.hasPermission()) {
                return true;
            }
            var range = _rangeUtilsRangeExtend2['default'].getRange();
            if (!range) {
                return true;
            }

            var keyCode = e.keyCode || e.which;

            var start, startOffset, end, isAfterCheck, main, container, tmpMain, mainParentTag, mainParent, childNodes, i, dom;

            var rangeList;
            if (!range.collapsed) {
                if (keyCode !== 8 && keyCode !== 46 && _commonUtils2['default'].checkNonTxtKey(e)) {
                    return true;
                }
                //将 选中的 checkbox cancelTodo
                rangeList = _rangeUtilsRangeExtend2['default'].getRangeDomList({
                    noSplit: true
                });
                if (rangeList) {
                    for (i = rangeList.list.length - 1; i >= 0; i--) {
                        dom = rangeList.list[i];
                        if (_todoUtils2['default'].isCheckbox(dom)) {
                            tmpMain = _todoUtils2['default'].getMainFromChild(dom);
                            if (tmpMain) {
                                container = tmpMain.parentNode;
                                _todoUtils2['default'].cancelTodo(container, true);
                            }
                        }
                    }
                }

                return true;
            }

            isAfterCheck = _todoUtils2['default'].isCaretAfterCheckbox();
            main = _todoUtils2['default'].getMainByCaret();
            container = _domUtilsDomExtend2['default'].getBlockParent(main, false);

            if (!container) {
                return true;
            }

            /**
             * Backspace
             */
            if (keyCode === 8 && isAfterCheck) {
                _todoUtils2['default'].cancelTodo(container);
                _commonUtils2['default'].stopEvent(e);
                return false;
            }

            /**
             * Delete
             */
            if (keyCode === 46) {
                start = range.startContainer;
                startOffset = range.startOffset;
                _rangeUtilsRangeExtend2['default'].selectCharIncludeFillChar();
                range = _rangeUtilsRangeExtend2['default'].getRange();
                end = range.endContainer;
                tmpMain = _todoUtils2['default'].getMainFromChild(end) || _todoUtils2['default'].getMainInDom(end);
                //恢复 range
                _rangeUtilsRangeExtend2['default'].setRange(start, startOffset);
                if (tmpMain && tmpMain != main) {
                    _todoUtils2['default'].cancelTodo(tmpMain.parentNode, true);
                    return false;
                }
            }

            /**
             * left
             */
            if (keyCode === 37 && isAfterCheck) {
                dom = _domUtilsDomExtend2['default'].getPreviousNode(container);
                if (dom) {
                    _rangeUtilsRangeExtend2['default'].setRange(dom, _domUtilsDomExtend2['default'].getDomEndOffset(dom));
                    _commonUtils2['default'].stopEvent(e);
                    return false;
                }
            }
            // /**
            //  * right
            //  */
            // if (keyCode === 39) {
            //     return;
            // }

            if (keyCode !== 13 || e.shiftKey) {
                return true;
            }

            // if (isBefore && container) {
            //     //如果在 checkbox 前输入回车
            //     node = ENV.doc.createElement(container.tagName);
            //     node.insertBefore(ENV.doc.createElement('br'), null);
            //     container.parentNode.insertBefore(node, container);
            //     utils.stopEvent(e);
            //     return;
            // }

            if (_todoUtils2['default'].isEmptyMain(main)) {
                //如果当前 todoList 为空，则 取消 todoList
                container.innerHTML = '<br>';
                _domUtilsDomExtend2['default'].removeClass(container, _commonConst2['default'].CLASS.TODO_LAYER);
                _rangeUtilsRangeExtend2['default'].setRange(container, 1);
                _commonUtils2['default'].stopEvent(e);
                return false;
            }

            mainParentTag = container == _commonEnv2['default'].doc.body ? 'div' : container.tagName;
            mainParent = _commonEnv2['default'].doc.createElement(mainParentTag);
            _domUtilsDomExtend2['default'].before(container, mainParent, true);
            range.deleteContents();
            range.setEndAfter(container);
            var frag = range.extractContents();
            childNodes = [];
            for (i = 0; i < frag.childNodes.length; i++) {
                childNodes.push(frag.childNodes[i]);
            }
            main = _todoUtils2['default'].setTodo(mainParent, todoRoute);
            _todoUtils2['default'].insertToMain(childNodes, main);

            // 如果换行操作的当前 块元素是 todoList，则 frag 内会自动生成 main
            // 必须要插入到 document 内才能正常清理 frag 内 main & block 元素
            for (i = 0; i < childNodes.length; i++) {
                _todoUtils2['default'].clearBlock(childNodes[i]);
            }

            _rangeUtilsRangeExtend2['default'].setRange(main, 1);
            _commonUtils2['default'].stopEvent(e);

            if (main.getBoundingClientRect().top + main.clientHeight > _commonEnv2['default'].doc.documentElement.clientHeight || main.getBoundingClientRect().top + main.clientHeight < 0) {
                var mainX = main.getBoundingClientRect().left + _commonEnv2['default'].doc.body.scrollLeft;
                var mainY = _commonEnv2['default'].doc.body.scrollTop + main.clientHeight;
                window.scrollTo(mainX, mainY);
            }
        },
        onSelectionChange: function onSelectionChange(e) {
            var range = _rangeUtilsRangeExtend2['default'].getRange();
            if (!range) {
                return;
            }
            var main, checkbox, start, startOffset, end, endOffset;
            if (!range.collapsed) {
                end = range.endContainer;
                endOffset = range.endOffset;
            }
            if (_todoUtils2['default'].isCaretBeforeCheckbox()) {
                main = _todoUtils2['default'].getMainByCaret();
                checkbox = _todoUtils2['default'].getCheckbox(main);

                if (checkbox && checkbox.nextSibling) {
                    start = checkbox.nextSibling;
                    startOffset = 0;
                } else if (main) {
                    start = main;
                    startOffset = _domUtilsDomExtend2['default'].getDomEndOffset(main);
                }

                if (start && end) {
                    _rangeUtilsRangeExtend2['default'].setRange(start, startOffset, end, endOffset);
                } else if (start) {
                    _rangeUtilsRangeExtend2['default'].setRange(start, startOffset);
                }
            }
        },
        onTouchStart: function onTouchStart(e) {
            curTouchTarget = e.target;
        },
        onTouchEnd: function onTouchEnd(e) {
            if (e.target !== curTouchTarget) {
                return;
            }
            curTouchTarget = null;
            beforeCheckTodo(e);
        }
    }
};

var todoCore = {
    init: function init() {},
    on: function on() {
        _todoUtils2['default'].oldPatch.fixOldTodo();
        patchForReader.init();
        _event.bind();
        todoRoute = _todoRouteForClient2['default'].getRoute();
        _todoUtils2['default'].checkTodoStyle(true);
    },
    off: function off() {
        _event.unbind();
    },
    checkTodoStyle: function checkTodoStyle() {
        _todoUtils2['default'].checkTodoStyle(false);
    },
    closeDocument: function closeDocument() {
        var html = patchForReader.modifyDoc();

        if (!_commonEnv2['default'].client.type.isIOS) {
            todoRoute.saveDoc(html, '');
        }

        if (todoRoute.beforeCloseDoc) {
            todoRoute.beforeCloseDoc();
        }

        patchForReader.init();
        return html;
    },
    onCheckDocLock: _event.handler.onCheckDocLock,
    onKeyDown: _event.handler.onKeyDown,
    setTodo: function setTodo() {
        _todoUtils2['default'].setTodo(null, todoRoute);
    },
    setTodoInfo: function setTodoInfo(options) {
        if (todoRoute.setTodoInfo) {
            todoRoute.setTodoInfo(options);
        }
    }
};

exports['default'] = todoCore;
module.exports = exports['default'];

},{"../common/const":13,"../common/env":15,"../common/utils":19,"../common/wizStyle":20,"../domUtils/domExtend":24,"../rangeUtils/rangeExtend":36,"./todoRouteForClient":44,"./todoUtils":45}],44:[function(require,module,exports){
/**
 * todolist 客户端适配接口
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

function routeForWindows(external) {

    if (external) {
        this.WizPcEditor = external;
    }

    this.getUserAlias = getUserAlias;
    this.getUserGuid = getUserGuid;
    this.getUserAvatarFileName = getUserAvatarFileName;
    this.isPersonalDocument = isPersonalDocument;
    this.setDocumentModified = setDocumentModified;
    this.setDocumentType = setDocumentType;
    this.hasPermission = hasPermission;
    //for Reader
    this.getOriginalDoc = getOriginalDoc;
    this.saveDoc = saveDoc;
    this.checkDocLock = checkDocLock;

    function getUserAlias() {
        return this.WizPcEditor.UserAlias;
    }

    function getUserGuid() {
        return this.WizPcEditor.GetUserGuid();
    }

    function getUserAvatarFileName(size) {
        return this.WizPcEditor.GetUserAvatarFileName(size);
    }

    function isPersonalDocument() {
        try {
            return this.WizPcEditor.WizDocument.IsPersonalDocument();
        } catch (e) {
            return false;
        }
    }

    function setDocumentModified() {
        this.WizPcEditor.SetContentModified(true);
    }

    function setDocumentType(type) {
        /*
         var oldType = this.wizDoc.Type;
         if (oldType) {
         if (-1 == oldType.indexOf(type)) {
         this.wizDoc.Type = oldType + ';' + type;
         }
         }
         else {
         this.wizDoc.Type = type;
         }*/
        if (this.WizPcEditor.WizDocument) {
            this.WizPcEditor.WizDocument.Type = type;
        }
    }

    function hasPermission() {
        return !_commonEnv2['default'].readonly || this.WizPcEditor.Window.CurrentDocument.CanEdit;
    }

    function getOriginalDoc() {
        try {
            return this.WizPcEditor.WizDocument.GetHtml();
        } catch (e) {
            return '';
        }
    }

    function saveDoc(html, resources) {
        this.WizPcEditor.WizDocument.SetHtml2(html, resources);
    }

    function checkDocLock(callback) {
        if (isPersonalDocument()) {
            WizReader.todo[callback](false, false);
            return;
        }
        this.WizPcEditor.ExecuteCommand("OnClickingChecklist", "WizReader.todo." + callback + "({cancel}, {needCallAgain});", "readingnote");
    }
}

function routeForWeb() {

    this.getUserAlias = getUserAlias;
    this.getUserGuid = getUserGuid;
    this.getUserAvatarFileName = getUserAvatarFileName;
    this.isPersonalDocument = isPersonalDocument;
    this.setDocumentModified = setDocumentModified;
    this.setDocumentType = setDocumentType;
    this.hasPermission = hasPermission;
    //for Reader
    this.getOriginalDoc = getOriginalDoc;
    this.saveDoc = saveDoc;
    this.checkDocLock = checkDocLock;

    function getUserAlias() {
        return 'zzz';
    }

    function getUserGuid() {
        return '63272832-e387-4d31-85c6-7549555f2231';
    }

    function getUserAvatarFileName() {
        return '/wizas/a/users/avatar/63272832-e387-4d31-85c6-7549555f2231?default=true';
    }

    function isPersonalDocument() {
        return false;
        // try {
        // 	return this.wizEditor.WizDocument.IsPersonalDocument();
        // }
        // catch (e) {
        // 	return false;
        // }
    }

    function setDocumentModified() {
        // this.wizEditor.SetContentModified(true);
    }

    function setDocumentType(type) {
        /*
         var oldType = this.wizDoc.Type;
         if (oldType) {
         if (-1 == oldType.indexOf(type)) {
         this.wizDoc.Type = oldType + ';' + type;
         }
         }
         else {
         this.wizDoc.Type = type;
         }*/
        // this.wizEditor.WizDocument.Type = type;
    }

    function hasPermission() {
        return true;
    }

    function getOriginalDoc() {
        return '<!DOCTYPE HTML>' + '<html><head>\n    <meta http-equiv="content-type" content="text/html;charset=utf-8">    <meta id="wiz-template-info" data-template-name="snow" data-template-version="0.0.1"> <link href="./common.css">   <style>        body {            font-family: sans-serif;        }    </style>    <style>        .wiz-table-tools {            display: block;            position: absolute;            top: 0px;            left: 0px;            border: 1px solid #ddd;            -webkit-border-radius: 5px;            -moz-border-radius: 5px;            border-radius: 5px;            z-index: 130;        }        .wiz-table-tools ul {            list-style: none;            padding: 0;        }        .wiz-table-tools .wiz-table-menu-item {            position: relative;            float: left;            margin: 5px 5px;        }        .wiz-table-tools .wiz-table-menu-item .wiz-table-menu-button {            width: 20px;            height: 20px;            cursor: pointer;            position: relative;        }        .wiz-table-tools i.editor-icon {            font-size: 20px;            color: #a6a6a6;        }        .wiz-table-tools .wiz-table-menu-item .wiz-table-menu-button i#wiz-menu-bg-demo {            position: absolute;            top: 0;            left: 0;        }        .wiz-table-tools .wiz-table-menu-sub {            position: absolute;            display: none;            width: 125px;            padding: 5px 0;            background: #fff;            border-radius: 3px;            border: 1px solid #E0E0E0;        }        .wiz-table-tools .wiz-table-menu-item.active .wiz-table-menu-sub {            display: block        }        .wiz-table-tools .wiz-table-menu-sub:before, .wiz-table-tools .wiz-table-menu-sub:after {            position: absolute;            content: " ";            border-style: solid;            border-color: transparent;            border-bottom-color: #cccccc;            left: 22px;            margin-left: -14px;            top: -8px;            border-width: 0 8px 8px 8px;            z-index: 10;        }        .wiz-table-tools .wiz-table-menu-sub:after {            border-bottom-color: #ffffff;            top: -7px;        }        .wiz-table-tools .wiz-table-menu-sub-item {            position: relative;            padding: 4px 12px;            font-size: 14px;        }        .wiz-table-tools .wiz-table-menu-sub-item.split {            border-top: 1px solid #E0E0E0;        }        .wiz-table-tools .wiz-table-menu-sub-item:hover {            background-color: #ececec;        }        .wiz-table-tools .wiz-table-menu-sub-item.disabled {            color: #bbbbbb;            cursor: default;        }        .wiz-table-tools .wiz-table-menu-sub-item.disabled:hover {            background-color: transparent;        }        .wiz-table-tools .wiz-table-menu-item.wiz-table-cell-bg:hover .wiz-table-color-pad {            display: block;        }        .wiz-table-tools .wiz-table-color-pad {            display: none;            padding: 10px;            box-sizing: border-box;            width: 92px;            height: 88px;            border: 0;            background-color: #fff;            box-shadow: 1px 1px 5px #d0d0d0;            cursor: default;        }        .wiz-table-tools .wiz-table-color-pad .wiz-table-color-pad-item {            display: inline-block;            width: 20px;            height: 20px;            margin-right: 6px;            position: relative;        }        .wiz-table-tools .wiz-table-color-pad .wiz-table-color-pad-item i.pad-demo {            position: absolute;            top: 0;            left: 0;        }        .wiz-table-tools .wiz-table-color-pad .wiz-table-color-pad-item .icon-oblique_line {            color: #cc0000;        }        .wiz-table-tools .wiz-table-color-pad .wiz-table-color-pad-item:last-child {            margin-right: 0;        }        .wiz-table-tools .wiz-table-color-pad .wiz-table-color-pad-item.active i.editor-icon.icon-box {            color: #448aff;        }        .wiz-table-tools .wiz-table-cell-align {            display: none;            padding: 10px;            box-sizing: border-box;            width: 92px;            height: 88px;            border: 0;            background-color: #fff;            box-shadow: 1px 1px 5px #d0d0d0;            cursor: default;        }        .wiz-table-tools .wiz-table-cell-align .wiz-table-cell-align-item {            display: inline-block;            width: 20px;            height: 20px;            margin-right: 6px;            position: relative;        }        .wiz-table-tools .wiz-table-cell-align .wiz-table-cell-align-item i.valign {            position: absolute;            top: 0;            left: 0;            color: #d2d2d2;        }        .wiz-table-tools .wiz-table-cell-align-item.active i.editor-icon.valign {            color: #a1c4ff;        }        .wiz-table-tools .wiz-table-cell-align-item.active i.editor-icon.icon-box,        .wiz-table-tools .wiz-table-cell-align-item.active i.editor-icon.align {            color: #448aff;        }        .wiz-table-tools .wiz-table-color-pad .wiz-table-color-pad-item:last-child,        .wiz-table-tools .wiz-table-cell-align .wiz-table-cell-align-item:last-child {            margin-right: 0;        }    </style>    <style>.wiz-template-editable {        outline: none;    }    span.h5 {        color: #b3c2dd;        padding-left: 4px;    }    .h5.title {        background-color: #a1c4ff;        color: #fff;        border-radius: 5px;        padding: 1px 4px;    }</style>    <style>html, body {        -webkit-box-sizing: border-box;        -moz-box-sizing: border-box;        box-sizing: border-box;    }    html {        height: 100%;    }    body {        min-height: 100%;    }    .content {        margin-top: 1rem;    }    .weather-animation {        width: 100%;        height: 175px;        position: relative;        border-radius: 5px;    }    .weather-animation.weather-snow {        background-image: url(index_files/wizIcon_snowBg.png) !important;        background-repeat: no-repeat;        background-position: center center;        background-size: cover;    }    img {        filter: brightness(100%) !important;        -webkit-filter: brightness(100%) !important;    }    div.hide {        display: none;    }    </style>    <meta id="wiz-amend-user" name="wiz-amend-user" content="{&quot;b38894c5-e4fa-4b68-9a29-4c941417bae8&quot;:{&quot;color&quot;:&quot;#0C9460&quot;,&quot;name&quot;:&quot;叶文洁&quot;},&quot;ec46024b-c6b2-446c-a5fa-2aa8690337e4&quot;:{&quot;color&quot;:&quot;#FF3399&quot;,&quot;name&quot;:&quot;史强&quot;},&quot;e0376e7b-e6a7-4a5d-bd48-378e9e50b0d0&quot;:{&quot;color&quot;:&quot;#FF6005&quot;,&quot;name&quot;:&quot;杨卫宁&quot;}}"></head><body ryt14262="1">\n<!-- todolist test start-->\n<div><label class="wiz-todo-label wiz-todo-label-checked"><img id="wiz_todo_1464076716986_142758" class="wiz-todo-img wiz-img-cannot-drag" state="checked"><span class="wiz-todo-tail"></span>asdfasdfadsfafsd\n</label><span class="wiz-todo-completed-info" wiz_todo_id="wiz_todo_1464076716986_142758"><span class="wiz-todo-account"><img src="http://note.wiz.cn/wizas/a/users/avatar/63272832-e387-4d31-85c6-7549555f2231?default=true" class="wiz-img-cannot-drag wiz-todo-avatar">hunter.z, </span><span class="wiz-todo-dt">2016<label class="wiz-todo-label wiz-todo-label-unchecked"><img id="wiz_todo_1464076731273_583098" class="wiz-todo-img wiz-img-cannot-drag" state="unchecked">sdfasdffds<span class="wiz-todo-tail"></span>sdfasdf年5月24日 15:58.</label></span></span><label class="wiz-todo-label wiz-todo-label-unchecked"><img id="wiz_todo_1464076723648_926833" class="wiz-todo-img wiz-img-cannot-drag" src="./checklist/unchecked.png" state="unchecked">dfasdfasdfasdf<span class="wiz-todo-tail"></span></label></div>\n<div><label class="wiz-todo-label wiz-todo-label-checked"><img id="wiz_todo_1463649633995_658524" class="wiz-todo-img wiz-img-cannot-drag" src="./checklist/checked.png" state="checked">\n    aaa</label>\n    <span class="wiz-todo-completed-info" wiz_todo_id="wiz_todo_1463649633995_658524"><span class="wiz-todo-account"><img src="http://note.wiz.cn/wizas/a/users/avatar/63272832-e387-4d31-85c6-7549555f2231?default=true" class="wiz-img-cannot-drag wiz-todo-avatar">zzz, </span><span class="wiz-todo-dt">Tue May 24 2016 10:07:30 GMT+0800 (中国标准时间).</span></span>\n</div>\n<div>\n    <label class="wiz-todo-label wiz-todo-label-unchecked">\n        <img id="wiz_todo_1463649792539_126202" class="wiz-todo-img wiz-img-cannot-drag" src="./checklist/unchecked.png" state="unchecked">\n        bbb<span class="wiz-todo-tail"></span>\n    </label>\n    <img id="wiz_todo_1464076716986_142759" class="wiz-todo-img wiz-img-cannot-drag" src="./checklist/unchecked.png" state="unchecked">111\n</div>\n<img id="wiz_todo_1464076716986_142754" class="wiz-todo-img wiz-img-cannot-drag" src="./checklist/unchecked.png" state="unchecked">222\n<div>\n    <label class="wiz-todo-label wiz-todo-label-checked"><img id="wiz_todo_1461039995611_127748" class="wiz-todo-img wiz-img-cannot-drag" src="./checklist/checked.png" state="checked">111111111\n    <div>&nbsp;<label class="wiz-todo-label wiz-todo-label-unchecked"><img id="wiz_todo_1461048880649_466877" class="wiz-todo-img wiz-img-cannot-drag" src="./checklist/checked.png">222222</label><span class="wiz-todo-completed-info"><span class="wiz-todo-account"><img class="wiz-img-cannot-drag wiz-todo-avatar" src="http://note.wiz.cn/wizas/a/users/avatar/63272832-e387-4d31-85c6-7549555f2231?default=true">张其纲, </span><span class="wiz-todo-dt">2016年4月21日 15:18.</span></span></div>\n    <div><label class="wiz-todo-label wiz-todo-label-unchecked"><img id="wiz_todo_1461049008116_810340" class="wiz-todo-img wiz-img-cannot-drag" src="./checklist/unchecked.png">333333333<div><label class="wiz-todo-label wiz-todo-label-unchecked"><img id="wiz_todo_1461049124381_436981" class="wiz-todo-img wiz-img-cannot-drag" src="./checklist/unchecked.png">4444444444</label></div></label></div><div><label class="wiz-todo-label wiz-todo-label-unchecked"><img id="wiz_todo_1461049378843_383647" class="wiz-todo-img wiz-img-cannot-drag" src="./checklist/unchecked.png">55555555<a href="http://fromwiz.com/share/s/1D_zxa0Evx7y2-XGX93B8vdw0T7I7g1G4knb25W1X93NIx1Q">http://fromwiz.com/share/s/1D_zxa0Evx7y2-XGX93B8vdw0T7I7g1G4knb25W1X93NIx1Q</a>&nbsp;<span class="wiz-todo-tail"></span></label></div><div><label class="wiz-todo-label wiz-todo-label-unchecked"><img id="wiz_todo_1461049233581_718877" class="wiz-todo-img wiz-img-cannot-drag" src="./checklist/unchecked.png">6666666<span class="wiz-todo-tail"></span></label><a href="wiz://open_document?guid=0fc88d4d-d172-4d39-909e-0b4216c24170&amp;kbguid=66e5c3f6-8482-11e1-a525-00237def97cc" style="line-height: 1.5;">表格测试</a></div><span class="wiz-todo-tail"></span></label><span class="wiz-todo-completed-info"><span class="wiz-todo-account"><img class="wiz-img-cannot-drag wiz-todo-avatar" src="http://note.wiz.cn/wizas/a/users/avatar/63272832-e387-4d31-85c6-7549555f2231?default=true">张其纲, </span><span class="wiz-todo-dt">2016年4月21日 15:19.</span></span></div>\n<!-- todolist test end-->\n\n<!-- wizTemplate test start-->\n<!--<div class="hide"><img src="index_files/wizIcon_snow0.png" class="snow0"><img src="index_files/wizIcon_snow1.png"-->\n<!--class="snow1"><img-->\n<!--src="index_files/wizIcon_snow2.png" class="snow2"><img src="index_files/wizIcon_snow3.png" class="snow3"></div>-->\n<!--<div class="weather-animation weather-snow"></div>-->\n<!--<div class="content wiz-template-editable wiz-template-focus"><p>-->\n<!--在南国下雪，尚还未下，天就阴沉，或者小雨、或者北风开道，气候是要那么翻来覆去地变幻几次，这才先撒下小米粒一般的雪子儿，然后，才是蚊子般的小雪从天空中钻出来，落了地上，眨眼便不见了踪影。这就跟南国人干什么事都沉不住气极爱大惊小怪一样，下上那么丁点儿的雪罢，何以还要把天气变过来变过去呢？倒是北国的雪来得大度，即是小，也足以让南国人惊讶的了。</p>-->\n<!--<p></p>-->\n<!--<p></p>-->\n<!--<p></p>-->\n<!--<p></p>-->\n<!--<p></p><br><br></div>-->\n<!-- wizTemplate test end-->\n\n\n<!-- input test start-->\n<!--<div><input type="text"></div>-->\n<!--<div><textarea></textarea></div>-->\n<!-- input test end-->\n\n<!-- table test start-->\n<table style="width: 400px;">\n<tbody>\n<tr>\n<td align="left" valign="middle" style="width: 132px;" class=""><br></td>\n<td align="left" valign="middle" style="width: 147px;" class="">asdf&nbsp;</td>\n<td align="left" valign="middle" style="width:120px" class="">asdf&nbsp;</td>\n</tr>\n<tr>\n<td align="left" valign="middle" style="width: 132px;" class=""><br></td>\n<td align="left" valign="middle" style="width: 267px;" class="" rowspan="2" colspan="2"><br>asdfadsf&nbsp;</td>\n</tr>\n<tr>\n<td align="left" valign="middle" style="width: 132px;"><br></td>\n</tr>\n</tbody>\n</table>\n<!-- table test end-->\n\n<!-- markdown test start-->\n<!--<div>$$f(x)=3x+7$$</div>-->\n<!--<div style="font-size: medium; line-height: normal; widows: 1; font-family: sans-serif;"><br></div>-->\n<!--<div style="font-size: medium; line-height: normal; widows: 1; font-family: sans-serif;">###流程图 测试</div>-->\n<!--<div style="font-size: medium; line-height: normal; widows: 1; font-family: sans-serif;"><br></div>-->\n<!--<div style="font-size: medium; line-height: normal; widows: 1; font-family: sans-serif;"><br>```flow</div>-->\n<!--<div style="font-size: medium; line-height: normal; widows: 1; font-family: sans-serif;">st=&gt;start: Start:&gt;http://www.google.com[blank]</div>-->\n<!--<div style="font-size: medium; line-height: normal; widows: 1; font-family: sans-serif;">e=&gt;end:&gt;http://www.google.com</div>-->\n<!--<div style="font-size: medium; line-height: normal; widows: 1; font-family: sans-serif;">op1=&gt;operation: My-->\n<!--Operation-->\n<!--</div>-->\n<!--<div style="font-size: medium; line-height: normal; widows: 1; font-family: sans-serif;">sub1=&gt;subroutine: My-->\n<!--Subroutine-->\n<!--</div>-->\n<!--<div style="font-size: medium; line-height: normal; widows: 1; font-family: sans-serif;">cond=&gt;condition: Yes</div>-->\n<!--<div style="font-size: medium; line-height: normal; widows: 1; font-family: sans-serif;">or No?</div>-->\n<!--<div style="font-size: medium; line-height: normal; widows: 1; font-family: sans-serif;">:&gt;http://www.google.com-->\n<!--</div>-->\n<!--<div style="font-size: medium; line-height: normal; widows: 1; font-family: sans-serif;">io=&gt;inputoutput: catch-->\n<!--something...|request-->\n<!--</div>-->\n<!--<div style="font-size: medium; line-height: normal; widows: 1; font-family: sans-serif;">st-&gt;op1-&gt;cond</div>-->\n<!--<div style="font-size: medium; line-height: normal; widows: 1; font-family: sans-serif;">cond(yes)-&gt;io-&gt;e</div>-->\n<!--<div style="font-size: medium; line-height: normal; widows: 1; font-family: sans-serif;">cond(no)-&gt;sub1(right)-&gt;op1</div>-->\n<!--<div style="font-size: medium; line-height: normal; widows: 1; font-family: sans-serif;">```<br></div>-->\n<!--<wiz_tmp_tag id="wiz-table-range-border" contenteditable="false" style="display: none;">-->\n<!--<div id="wiz-table-col-line" style="display: none;"></div>-->\n<!--<div id="wiz-table-row-line" style="display: none;"></div>-->\n<!--<div id="wiz-table-range-border_start" style="display: none;">-->\n<!--<div id="wiz-table-range-border_start_top"></div>-->\n<!--<div id="wiz-table-range-border_start_right"></div>-->\n<!--<div id="wiz-table-range-border_start_bottom"></div>-->\n<!--<div id="wiz-table-range-border_start_left"></div>-->\n<!--<div id="wiz-table-range-border_start_dot"></div>-->\n<!--</div>-->\n<!--<div id="wiz-table-range-border_range" style="display: none;">-->\n<!--<div id="wiz-table-range-border_range_top"></div>-->\n<!--<div id="wiz-table-range-border_range_right"></div>-->\n<!--<div id="wiz-table-range-border_range_bottom"></div>-->\n<!--<div id="wiz-table-range-border_range_left"></div>-->\n<!--<div id="wiz-table-range-border_range_dot"></div>-->\n<!--</div>-->\n<!--</wiz_tmp_tag>-->\n<!-- markdown test end-->\n\n\n\n</body></html>';
    }

    function saveDoc(html, resources) {
        console.log('saveDoc');
    }

    function checkDocLock(callback) {
        setTimeout(function () {
            WizReader.todo.onCheckDocLock(false, false);
        }, 500);
        // if (isPersonalDocument()) {
        //     WizReader.todo.onCheckDocLock(false, false);
        //     return;
        // }
        // this.WizPcEditor.ExecuteCommand("OnClickingChecklist",
        //     "WizReader.todo." + callback + "({cancel}, {needCallAgain});", "readingnote");
    }
}

function routeForMac() {

    this.getUserAlias = getUserAlias;
    this.getUserGuid = getUserGuid;
    this.getUserAvatarFileName = getUserAvatarFileName;
    this.isPersonalDocument = isPersonalDocument;
    this.setDocumentModified = setDocumentModified;
    this.setDocumentType = setDocumentType;
    this.hasPermission = hasPermission;
    //for Reader
    this.getOriginalDoc = getOriginalDoc;
    this.saveDoc = saveDoc;
    this.checkDocLock = checkDocLock;

    function getUserAlias() {
        return window.WizQtEditor.userAlias;
    }

    function getUserGuid() {
        return window.WizQtEditor.userGuid;
    }

    function getUserAvatarFileName(size) {
        return window.WizQtEditor.userAvatarFilePath;
    }

    function isPersonalDocument() {
        return window.WizQtEditor.isPersonalDocument;
    }

    function setDocumentModified() {
        // window.WizQtEditor.setContentsChanged(true);
    }

    function setDocumentType(type) {
        window.WizQtEditor.setCurrentDocumentType(type);
    }

    function hasPermission() {
        return !_commonEnv2['default'].readonly || window.WizQtEditor.hasEditPermissionOnCurrentNote;
    }

    function getOriginalDoc() {
        return window.WizQtEditor.currentNoteHtml;
    }

    function saveDoc(html, resources) {
        window.WizQtEditor.saveHtmlToCurrentNote(html, resources);
    }

    function checkDocLock(callback) {
        window.WizQtEditor.clickingTodoCallBack.connect(WizReader.todo[callback]);
        return window.WizQtEditor.checkListClickable();
    }
}

function routeForAndroid() {

    this.getUserAlias = getUserAlias;
    this.getUserGuid = getUserGuid;
    this.getUserAvatarFileName = getUserAvatarFileName;
    this.isPersonalDocument = isPersonalDocument;
    this.setDocumentModified = setDocumentModified;
    this.setDocumentType = setDocumentType;
    this.hasPermission = hasPermission;
    //for Reader
    this.getOriginalDoc = getOriginalDoc;
    this.saveDoc = saveDoc;
    this.checkDocLock = checkDocLock;
    this.beforeCloseDoc = beforeCloseDoc;

    function getUserAlias() {
        return window.WizNote.getUserAlias();
    }

    function getUserGuid() {
        return window.WizNote.getUserGuid();
    }

    function getUserAvatarFileName(size) {
        return window.WizNote.getUserAvatarFileName(size);
    }

    function isPersonalDocument() {
        return window.WizNote.isPersonalDocument();
    }

    function setDocumentModified() {
        window.WizNote.setDocumentModified();
    }

    function setDocumentType(type) {
        window.WizNote.setDocumentType(type);
    }

    function hasPermission() {
        return !_commonEnv2['default'].readonly || window.WizNote.hasPermission();
    }

    function getOriginalDoc() {
        return window.WizNote.getDocHtml();
    }

    function saveDoc(html, resources) {
        window.WizNote.setDocHtml(html, resources);
    }

    function checkDocLock(callback) {
        window.WizNote.onClickingTodo();
    }

    function beforeCloseDoc() {
        window.WizNote.onWizTodoReadCheckedClose();
    }
}

function routeForIOS() {

    this.getUserAlias = getUserAlias;
    this.getUserGuid = getUserGuid;
    this.getUserAvatarFileName = getUserAvatarFileName;
    this.isPersonalDocument = isPersonalDocument;
    this.setDocumentModified = setDocumentModified;
    this.setDocumentType = setDocumentType;
    this.setTodoInfo = setTodoInfo;
    this.hasPermission = hasPermission;

    //for Reader
    this.getOriginalDoc = getOriginalDoc;
    this.checkDocLock = checkDocLock;

    this.userAlias = '';
    this.userGuid = '';
    this.avatarFileName = '';
    this.personalDocument = false;
    this._hasPermission = false;
    this.originalHtml = "";

    function setTodoInfo(options) {
        this.userAlias = options.alias;
        this.userGuid = options.userGuid;
        this.avatarFileName = options.avatar;
        this.personalDocument = options.isPersonal === 'true';
        this._hasPermission = options.hasPermission === 'true';
        this.originalHtml = options.docHtml;
    }

    function getUserAlias() {
        return this.userAlias;
    }

    function getUserGuid() {
        return this.userGuid;
    }

    function getUserAvatarFileName(size) {
        return this.avatarFileName;
    }

    function isPersonalDocument() {
        return this.personalDocument;
    }

    function setDocHtml(html, resources) {
        window.location.href = "wiztodolist://setDocHtml/" + "?html=" + html + "&resource=" + resources;
    }

    function setDocumentModified() {
        window.location.href = "wiztodolist://setDocumentModified/";
    }

    function setDocumentType(type) {
        window.location.href = "wiztodolist://setDocumentType/" + "?type=" + type;
    }

    function hasPermission() {
        return !_commonEnv2['default'].readonly || this._hasPermission;
    }

    function getOriginalDoc() {
        return this.originalHtml;
    }

    function checkDocLock(callback) {
        window.location.href = "wiztodolist://tryLockDocument/" + "?callback=" + callback;
    }
}

var todoClientRoute = {
    getRoute: function getRoute() {
        var route = null;
        if (_commonEnv2['default'].client.type.isWin) {
            route = new routeForWindows(external);
        } else if (_commonEnv2['default'].client.type.isMac) {
            route = new routeForMac();
        } else if (_commonEnv2['default'].client.type.isIOS) {
            route = new routeForIOS();
        } else if (_commonEnv2['default'].client.type.isAndroid) {
            route = new routeForAndroid();
        } else {
            route = new routeForWeb();
        }

        return route;
    }
};

exports['default'] = todoClientRoute;
module.exports = exports['default'];

},{"../common/env":15}],45:[function(require,module,exports){
/**
 * todolist 基本工具包
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('../common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

var _commonConst = require('../common/const');

var _commonConst2 = _interopRequireDefault(_commonConst);

var _commonLang = require('../common/lang');

var _commonLang2 = _interopRequireDefault(_commonLang);

var _commonBase64 = require('./../common/Base64');

var _commonBase642 = _interopRequireDefault(_commonBase64);

var _commonWizStyle = require('../common/wizStyle');

var _commonWizStyle2 = _interopRequireDefault(_commonWizStyle);

var _domUtilsDomExtend = require('../domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

var _rangeUtilsRangeExtend = require('../rangeUtils/rangeExtend');

var _rangeUtilsRangeExtend2 = _interopRequireDefault(_rangeUtilsRangeExtend);

var _commonHistoryUtils = require('../common/historyUtils');

var _commonHistoryUtils2 = _interopRequireDefault(_commonHistoryUtils);

var todoUtils = {
    addUserInfo: function addUserInfo(main, isChecked, todoId, todoRoute) {
        if (!main) {
            return;
        }

        var userGuid, userName, avatarUrl, dt, userHtml, span, child, next, i;

        userGuid = todoUtils.deleteUserInfo(main.parentNode);
        if (!isChecked) {
            _commonWizStyle2['default'].removeUnUsedTodoStyle(userGuid);
            return;
        }

        userGuid = todoRoute.getUserGuid();
        userName = todoRoute.getUserAlias();
        avatarUrl = todoRoute.getUserAvatarFileName(_commonConst2['default'].CSS.TODO_LIST.IMG_WIDTH);
        dt = todoUtils.getTime();
        todoUtils.setUserAvatarStyle(userGuid, avatarUrl);
        userHtml = todoUtils.getUserInfoHtml(userGuid, userName, dt);

        span = _commonEnv2['default'].doc.createElement('span');
        _domUtilsDomExtend2['default'].addClass(span, _commonConst2['default'].CLASS.TODO_USER_INFO);
        span.innerHTML = userHtml;
        span.setAttribute(_commonConst2['default'].ATTR.TODO_ID, todoId);

        for (i = main.childNodes.length - 1; i >= 0; i--) {
            child = main.childNodes[i];
            if (child.tagName && child.tagName.toLowerCase() == 'br') {
                main.removeChild(child);
            }
        }
        next = main.nextElementSibling;
        while (next) {
            if (todoUtils.isMain(next)) {
                main.parentElement.insertBefore(span, next);
                break;
            }
            if (next.tagName.toLowerCase() == 'br') {
                main.parentElement.insertBefore(span, next);
                break;
            }
            next = next.nextElementSibling;
        }
        if (!next) {
            main.parentElement.appendChild(span);
        }
        if (!span.hasChildNodes()) {
            span.appendChild(_commonEnv2['default'].doc.createElement('br'));
        }
        _rangeUtilsRangeExtend2['default'].setRange(span, span.childNodes.length);
    },
    /**
     * 判断 dom 是否可以当作 main 容器
     * @param dom
     * @returns {boolean}
     */
    canBeContainer: function canBeContainer(dom) {
        return !_domUtilsDomExtend2['default'].isTag(dom, ['body', 'td', 'th']) && _domUtilsDomExtend2['default'].isBlockDom(dom);
    },
    cancelTodo: function cancelTodo(container, noSetRange) {
        if (!container) {
            return;
        }
        _commonHistoryUtils2['default'].saveSnap(false);
        var range = _rangeUtilsRangeExtend2['default'].getRange(),
            start,
            startOffset,
            main,
            todoFirst,
            userGuid;
        start = range ? range.startContainer : null;
        startOffset = range ? range.startOffset : 0;
        main = todoUtils.getMainInDom(container);
        userGuid = todoUtils.deleteUserInfo(container);
        _commonWizStyle2['default'].removeUnUsedTodoStyle(userGuid);
        todoFirst = todoUtils.deleteMain(main);
        todoFirst = todoFirst ? todoFirst.start : null;
        _domUtilsDomExtend2['default'].removeClass(container, _commonConst2['default'].CLASS.TODO_LAYER);
        if (!todoFirst) {
            todoFirst = _commonEnv2['default'].doc.createElement('br');
            container.appendChild(todoFirst);
        }
        if (!noSetRange) {
            if (!start || !start.parentNode) {
                start = todoFirst;
                startOffset = 0;
            }
            _rangeUtilsRangeExtend2['default'].setRange(start, startOffset);
        }
        //修正 todoList style
        todoUtils.checkTodoStyle(false);
    },
    check: function check(main, isChecked) {
        if (isChecked) {
            _domUtilsDomExtend2['default'].removeClass(main, _commonConst2['default'].CLASS.TODO_UNCHECKED);
            _domUtilsDomExtend2['default'].addClass(main, _commonConst2['default'].CLASS.TODO_CHECKED);
        } else {
            _domUtilsDomExtend2['default'].removeClass(main, _commonConst2['default'].CLASS.TODO_CHECKED);
            _domUtilsDomExtend2['default'].addClass(main, _commonConst2['default'].CLASS.TODO_UNCHECKED);
        }
        var check = todoUtils.getCheckbox(main);
        var state = isChecked ? 'checked' : 'unchecked';
        check.setAttribute(_commonConst2['default'].ATTR.TODO_CHECK, state);
    },
    checkTodo: function checkTodo(checkImg, todoRoute) {
        var result = {
            id: '',
            checked: false
        };

        _commonHistoryUtils2['default'].saveSnap(false);

        var main = todoUtils.getMainFromChild(checkImg),
            isChecked;
        if (!main || main.children[0] != checkImg) {
            todoUtils.fixCheckbox(checkImg, false);
        }

        isChecked = checkImg.getAttribute(_commonConst2['default'].ATTR.TODO_CHECK) !== 'checked';
        todoUtils.check(main, isChecked);
        result.id = checkImg.id;
        result.checked = isChecked;

        if (!todoRoute.isPersonalDocument()) {
            todoUtils.addUserInfo(main, isChecked, checkImg.id, todoRoute);
        }

        if (todoRoute.isPersonalDocument() || !_commonEnv2['default'].client.type.isIOS) {
            todoRoute.setDocumentModified();
        }

        return result;
    },
    checkTodoStyle: function checkTodoStyle(isForced) {
        var todoObj = _commonEnv2['default'].doc.querySelector('.' + _commonConst2['default'].CLASS.TODO_MAIN);
        if (todoObj) {
            _commonWizStyle2['default'].insertTodoStyle(isForced);
        } else {
            _commonWizStyle2['default'].removeTodoStyle();
        }
    },
    clearBlock: function clearBlock(dom) {
        if (!dom || dom.nodeType !== 1 && dom.nodeType !== 3 && dom.nodeType !== 11) {
            return false;
        }
        var child, i;
        for (i = 0; i < dom.childNodes.length; i++) {
            child = dom.childNodes[i];
            if (todoUtils.clearBlock(child) && child != dom.childNodes[i]) {
                i--;
            }
        }

        var isFragment = dom.nodeType == 11,
            isMain = isFragment ? false : todoUtils.isMain(dom),
            isTodoTag = isFragment ? false : todoUtils.isTodoTag(dom),
            isBlock = isFragment ? false : _domUtilsDomExtend2['default'].isBlockDom(dom);
        if ((isBlock || isTodoTag) && _domUtilsDomExtend2['default'].isEmptyDom(dom)) {
            dom.parentNode.removeChild(dom);
            return true;
        } else if (isBlock) {
            _domUtilsDomExtend2['default'].stripDom(dom);
        } else if (isMain) {
            todoUtils.deleteMain(dom);
        }
        return false;
    },
    deleteMain: function deleteMain(main) {
        return _domUtilsDomExtend2['default'].stripDom(main, function (dom) {
            return !todoUtils.isMain(dom) && !todoUtils.isCheckbox(dom);
        });
    },
    deleteUserInfo: function deleteUserInfo(container) {
        var userGuid = '';
        var main = todoUtils.getMainInDom(container);

        var userAvatar = container.querySelector('.' + _commonConst2['default'].CLASS.TODO_AVATAR),
            userClass = userAvatar ? userAvatar.className : '',
            guidReg = new RegExp('^(.*' + _commonConst2['default'].CLASS.TODO_USER_AVATAR + ')([^ ]*)(.*)$', 'i');

        if (userClass.indexOf(_commonConst2['default'].CLASS.TODO_USER_AVATAR) > -1) {
            userGuid = userClass.replace(guidReg, '$2');
        }

        var nextSib = main ? main.nextElementSibling : container.firstChild,
            tmpNode;
        while (nextSib) {
            if (todoUtils.isMain(nextSib)) {
                break;
            }
            if (todoUtils.isUserInfo(nextSib)) {
                tmpNode = nextSib;
                nextSib = nextSib.nextElementSibling;
                container.removeChild(tmpNode);
                continue;
            }
            nextSib = nextSib.nextElementSibling;
        }
        return userGuid;
    },
    fixCheckbox: function fixCheckbox(checkImg, isForOld) {
        if (!checkImg) {
            return;
        }
        var container = _domUtilsDomExtend2['default'].getBlockParent(checkImg),
            canBeContainer = todoUtils.canBeContainer(container),
            main = _commonEnv2['default'].doc.createElement('span'),
            newContainer,
            next,
            tmpNext,
            stopInsert = false,
            dom;
        main.className = (isForOld ? _commonConst2['default'].CLASS.TODO_LABEL_OLD : _commonConst2['default'].CLASS.TODO_MAIN) + ' ' + _commonConst2['default'].CLASS.TODO_UNCHECKED;

        newContainer = _commonEnv2['default'].doc.createElement(canBeContainer ? container.tagName : 'div');
        if (canBeContainer) {
            _domUtilsDomExtend2['default'].before(container, newContainer, true);
        } else {
            _domUtilsDomExtend2['default'].before(checkImg, newContainer);
        }
        newContainer.appendChild(main);

        next = checkImg;
        while (next) {
            tmpNext = next.nextSibling;
            if (_domUtilsDomExtend2['default'].isBlockDom(next)) {
                if (canBeContainer) {
                    stopInsert = true;
                    dom = newContainer.nextSibling;
                } else {
                    break;
                }
            }
            if (stopInsert) {
                _domUtilsDomExtend2['default'].before(dom, next);
            } else if (todoUtils.isUserInfo(next)) {
                _domUtilsDomExtend2['default'].before(main, next, true);
            } else {
                main.appendChild(next);
            }
            next = tmpNext;
        }
    },
    getCheckbox: function getCheckbox(main) {
        if (!main) {
            return null;
        }
        return main.querySelector('.' + _commonConst2['default'].CLASS.TODO_CHECKBOX);
    },
    getUserInfoHtml: function getUserInfoHtml(userGuid, userName, dt) {
        var html = '<span class="' + _commonConst2['default'].CLASS.TODO_ACCOUNT + '">' + '<input readonly class="%1" />' + '%2, ' + '</span>' + '<span class="' + _commonConst2['default'].CLASS.TODO_DATE + '">%3.</span>';
        var avatarClass = _commonConst2['default'].CLASS.TODO_USER_AVATAR + _commonBase642['default'].encode(userGuid);
        return html.replace('%1', _commonConst2['default'].CLASS.IMG_NOT_DRAG + ' ' + _commonConst2['default'].CLASS.TODO_AVATAR + ' ' + avatarClass).replace('%2', userName).replace('%3', dt);
    },
    getMainHtml: function getMainHtml() {
        var str = '<span class="' + _commonConst2['default'].CLASS.TODO_MAIN + ' ' + _commonConst2['default'].CLASS.TODO_UNCHECKED + '">' + '<input readonly id="%1" class="' + _commonConst2['default'].CLASS.TODO_CHECKBOX + ' ' + _commonConst2['default'].CLASS.IMG_NOT_DRAG + '" ' + _commonConst2['default'].ATTR.TODO_CHECK + '="unchecked" />' + '</span>';
        str = str.replace('%1', 'wiz_todo_' + Date.now() + '_' + Math.floor(Math.random() * 1000000 + 1));
        return str;
    },
    getMainInDom: function getMainInDom(dom) {
        if (!dom || !dom.hasChildNodes()) return null;
        if (todoUtils.isMain(dom)) {
            return dom;
        }
        if (_domUtilsDomExtend2['default'].hasClass(dom, _commonConst2['default'].CLASS.TODO_LAYER)) {
            return dom.querySelector('.' + _commonConst2['default'].CLASS.TODO_MAIN);
        }
        return null;
    },
    getUserInfoInDom: function getUserInfoInDom(dom) {
        return dom.querySelector('.' + _commonConst2['default'].CLASS.TODO_USER_INFO);
    },
    getMainByCaret: function getMainByCaret() {
        var range = _rangeUtilsRangeExtend2['default'].getRange();
        if (!range) {
            return null;
        }

        var start = range.startContainer;
        if (_domUtilsDomExtend2['default'].isEmptyDom(start) && range.startOffset == _domUtilsDomExtend2['default'].getDomEndOffset(start)) {
            start = _domUtilsDomExtend2['default'].getNextNode(start, false);
        }
        var p = _domUtilsDomExtend2['default'].getParentByFilter(start, function (dom) {
            return _domUtilsDomExtend2['default'].hasClass(dom, _commonConst2['default'].CLASS.TODO_LAYER);
        }, true);
        if (!p || !p.hasChildNodes()) {
            return null;
        }
        return todoUtils.getMainInDom(p);
    },
    getMainFromChild: function getMainFromChild(dom) {
        if (!dom) {
            return null;
        }
        return _domUtilsDomExtend2['default'].getParentByFilter(dom, function (dom) {
            return _domUtilsDomExtend2['default'].hasClass(dom, _commonConst2['default'].CLASS.TODO_MAIN);
        }, true);
    },
    getTime: function getTime() {
        var dt = new Date();
        var dateStr, timeStr;
        timeStr = getNum(dt.getHours()) + ':' + getNum(dt.getMinutes());

        if (_commonLang2['default'].version == 'en') {
            dateStr = _commonLang2['default'].Month[dt.getMonth()] + ' ' + dt.getDate() + ', ' + dt.getFullYear() + ' at ' + timeStr;
        } else {
            dateStr = dt.getFullYear() + _commonLang2['default'].Date.Year + (dt.getMonth() + 1) + _commonLang2['default'].Date.Month + dt.getDate() + _commonLang2['default'].Date.Day + ' ' + timeStr;
        }
        return dateStr;

        function getNum(num) {
            return (num < 10 ? '0' : '') + num;
        }
    },
    insertToMain: function insertToMain(doms, main) {
        if (!doms || !main) {
            return;
        }
        var i,
            dom,
            last = null;
        for (i = doms.length - 1; i >= 0; i--) {
            dom = doms[i];
            _domUtilsDomExtend2['default'].removeClass(dom, _commonConst2['default'].CLASS.TODO_MAIN);
            _domUtilsDomExtend2['default'].removeClass(dom, _commonConst2['default'].CLASS.TODO_CHECKED);
            _domUtilsDomExtend2['default'].removeClass(dom, _commonConst2['default'].CLASS.TODO_UNCHECKED);
            main.insertBefore(dom, last);
            last = dom;
        }
    },
    /**
     * 判断 光标是否处于 checkbox 后面
     * @returns {*}
     */
    isCaretAfterCheckbox: function isCaretAfterCheckbox() {
        var range = _rangeUtilsRangeExtend2['default'].getRange();
        if (!range) {
            return false;
        }
        var caretDom, startOffset, prev, main;

        main = todoUtils.getMainByCaret();
        if (!main) {
            return false;
        }
        if (range.collapsed) {
            caretDom = range.startContainer;
            startOffset = range.startOffset;
            if (caretDom.nodeType === 1) {
                caretDom = caretDom.childNodes[range.startOffset];
            } else if (caretDom.nodeType == 3 && startOffset > 0) {
                return false;
            }
            prev = _domUtilsDomExtend2['default'].getPreviousNode(caretDom, false, main);
            return todoUtils.isCheckbox(prev);
        }
        return false;
    },
    /**
     * 判断 光标是否处于 main 最前面
     * @returns {*}
     */
    isCaretBeforeCheckbox: function isCaretBeforeCheckbox() {
        var range = _rangeUtilsRangeExtend2['default'].getRange();
        if (!range) {
            return false;
        }
        var caretDom = range.startContainer;
        if (caretDom.nodeType === 1) {
            caretDom = caretDom.childNodes[range.startOffset];
        } else if (caretDom.nodeType === 3 && _domUtilsDomExtend2['default'].isEmptyDom(caretDom) && range.startOffset == caretDom.nodeValue.length) {
            caretDom = _domUtilsDomExtend2['default'].getNextNode(caretDom, false);
            if (caretDom) {
                caretDom = _domUtilsDomExtend2['default'].getParentByFilter(caretDom, function (dom) {
                    return _domUtilsDomExtend2['default'].hasClass(dom, _commonConst2['default'].CLASS.TODO_LAYER);
                }, true);
            }
        }

        return todoUtils.isLayer(caretDom) || todoUtils.isMain(caretDom) || todoUtils.isCheckbox(caretDom);
    },
    /**
     * 判断 dom 是否为 todoList 的 checkbox
     * @param dom
     * @returns {*|boolean}
     */
    isCheckbox: function isCheckbox(dom) {
        return _domUtilsDomExtend2['default'].hasClass(dom, _commonConst2['default'].CLASS.TODO_CHECKBOX);
    },
    isEmptyMain: function isEmptyMain(main) {
        if (!main) {
            return true;
        }
        var childNodes = main.childNodes,
            i,
            child;

        for (i = 0; i < childNodes.length; i++) {
            child = childNodes[i];
            if (!todoUtils.isCheckbox(child) && !_domUtilsDomExtend2['default'].isEmptyDom(child)) {
                return false;
            }
        }
        return true;
    },
    /**
     * 判断 dom 是否为 todoList 的 main
     * @param dom
     * @returns {*|boolean}
     */
    isMain: function isMain(dom) {
        return _domUtilsDomExtend2['default'].hasClass(dom, _commonConst2['default'].CLASS.TODO_MAIN);
    },
    isLayer: function isLayer(dom) {
        return _domUtilsDomExtend2['default'].hasClass(dom, _commonConst2['default'].CLASS.TODO_LAYER);
    },
    /**
     * 判断 dom 是否为 todoList 内的有效 dom
     * @param dom
     * @returns {boolean}
     */
    isTodoTag: function isTodoTag(dom) {
        if (!dom) {
            return false;
        }
        return !!_domUtilsDomExtend2['default'].getParentByFilter(dom, function (obj) {
            return todoUtils.isMain(obj) || todoUtils.isUserInfo(obj) || _domUtilsDomExtend2['default'].hasClass(obj, _commonConst2['default'].CLASS.TODO_ACCOUNT) || _domUtilsDomExtend2['default'].hasClass(obj, _commonConst2['default'].CLASS.TODO_DATE);
        }, true);
    },
    /**
     * 判断 dom 是否为 用户信息
     * @param dom
     * @returns {*|boolean}
     */
    isUserInfo: function isUserInfo(dom) {
        return _domUtilsDomExtend2['default'].hasClass(dom, _commonConst2['default'].CLASS.TODO_USER_INFO);
    },
    setTodo: function setTodo(container, todoRoute) {
        var range = _rangeUtilsRangeExtend2['default'].getRange(),
            rangeList,
            start,
            end,
            mainHtml,
            main,
            userInfo,
            tmpDom;
        if (container) {
            //允许指定 容器直接设置 todoList
            start = container;
        } else {
            //判断当前光标范围内是否只有一个 块结构，否则不做任何操作
            if (!range) {
                return null;
            }
            rangeList = _rangeUtilsRangeExtend2['default'].getRangeDomList({
                noSplit: true
            });
            start = _domUtilsDomExtend2['default'].getBlockParent(rangeList.startDom, true);
            if (!start) {
                return null;
            }
            if (!range.collapsed && rangeList.endDom != rangeList.startDom) {
                end = _domUtilsDomExtend2['default'].getBlockParent(rangeList.endDom, true);
                if (end != start) {
                    return null;
                }
            }
        }

        //判断当前行是否已经是 todoList 结构，如果是，则取消 todoList 结构
        main = todoUtils.getMainInDom(start);
        userInfo = todoUtils.getUserInfoInDom(start);
        _commonHistoryUtils2['default'].saveSnap(false);
        var hasCheckbox = !!todoUtils.getCheckbox(main);
        if (main || userInfo) {
            todoUtils.cancelTodo(start);
        }
        if (hasCheckbox) {
            return null;
        }

        mainHtml = todoUtils.getMainHtml();
        tmpDom = _commonEnv2['default'].doc.createElement('div');
        _domUtilsDomExtend2['default'].addClass(tmpDom, _commonConst2['default'].CLASS.TODO_LAYER);
        if (!todoUtils.canBeContainer(start)) {
            mainHtml = '<div class="' + _commonConst2['default'].CLASS.TODO_LAYER + '">' + mainHtml + '</div>';
        } else {
            _domUtilsDomExtend2['default'].addClass(start, _commonConst2['default'].CLASS.TODO_LAYER);
        }
        tmpDom.innerHTML = mainHtml;
        main = todoUtils.getMainInDom(tmpDom);
        end = main.lastChild;
        todoUtils.insertToMain(start.childNodes, main);

        while (tmpDom.firstChild) {
            start.appendChild(tmpDom.firstChild);
        }
        _rangeUtilsRangeExtend2['default'].setRange(end, _domUtilsDomExtend2['default'].getDomEndOffset(end));

        //通知客户端笔记被修改
        todoRoute.setDocumentType(_commonConst2['default'].TYPE.TODO);
        todoRoute.setDocumentModified();

        //修正 todoList style
        todoUtils.checkTodoStyle(false);

        return main;
    },
    setUserAvatarStyle: function setUserAvatarStyle(userGuid, avatarUrl) {
        var guid = _commonBase642['default'].encode(userGuid);
        var sId = _commonConst2['default'].ID.TODO_AVATAR_STYLE + guid;
        var sClass = _commonConst2['default'].CLASS.TODO_USER_AVATAR + guid;
        var style = _commonEnv2['default'].doc.getElementById(sId);
        if (style) {
            return;
        }
        _domUtilsDomExtend2['default'].convertImageToBase64(avatarUrl, 50, 50, function (baseStr) {
            //有可能同时点击多个 todoList
            var style = _commonEnv2['default'].doc.getElementById(sId);
            if (style) {
                return;
            }
            _commonWizStyle2['default'].insertStyle({ id: sId }, '.' + sClass + '{background-image:url(' + baseStr + ');}');
        });
    },
    oldPatch: {
        fixImg: function fixImg(img) {
            if (!img) {
                return;
            }
            var iObj = _commonEnv2['default'].doc.createElement('input');
            iObj.className = img.className;
            _domUtilsDomExtend2['default'].removeClass(iObj, _commonConst2['default'].CLASS.TODO_CHECK_IMG_OLD);
            _domUtilsDomExtend2['default'].addClass(iObj, _commonConst2['default'].CLASS.TODO_CHECKBOX);
            iObj.readOnly = true;
            if (img.id) {
                iObj.id = img.id;
            }
            if (img.getAttribute('state')) {
                iObj.setAttribute(_commonConst2['default'].ATTR.TODO_CHECK, img.getAttribute('state'));
            }
            var parent = img.parentNode;
            parent.insertBefore(iObj, img);
            parent.removeChild(img);
        },
        fixLabel: function fixLabel(label) {
            if (label) {
                _domUtilsDomExtend2['default'].removeClass(label, _commonConst2['default'].CLASS.TODO_LABEL_OLD);
                _domUtilsDomExtend2['default'].addClass(label, _commonConst2['default'].CLASS.TODO_MAIN);
                if (_domUtilsDomExtend2['default'].hasClass(label, _commonConst2['default'].CLASS.TODO_CHECKED_OLD)) {
                    _domUtilsDomExtend2['default'].removeClass(label, _commonConst2['default'].CLASS.TODO_CHECKED_OLD);
                    _domUtilsDomExtend2['default'].addClass(label, _commonConst2['default'].CLASS.TODO_CHECKED);
                } else if (_domUtilsDomExtend2['default'].hasClass(label, _commonConst2['default'].CLASS.TODO_UNCHECKED_OLD)) {
                    _domUtilsDomExtend2['default'].removeClass(label, _commonConst2['default'].CLASS.TODO_UNCHECKED_OLD);
                    _domUtilsDomExtend2['default'].addClass(label, _commonConst2['default'].CLASS.TODO_UNCHECKED);
                }
            }

            if (!label || _domUtilsDomExtend2['default'].isTag(label, 'span')) {
                return;
            }
            var parent = label.parentNode;
            if (!parent) {
                return;
            }
            var span = _commonEnv2['default'].doc.createElement('span');
            span.className = label.className;
            while (label.firstChild) {
                span.appendChild(label.firstChild);
            }
            parent.insertBefore(span, label);
            parent.removeChild(label);
        },
        /**
         * 初始化 todoList 主要用于修正旧版本的 todoList 样式
         * 保证每个 todoItem 占一行
         */
        fixOldTodo: function fixOldTodo() {
            var i, j, subLabelList, subLabel, container, subContainer, checkImgList, checkImg, labelList, label, tailList, tail;

            //修正未被 label 封装的 checkImg
            checkImgList = _commonEnv2['default'].doc.querySelectorAll('.' + _commonConst2['default'].CLASS.TODO_CHECK_IMG_OLD);
            for (i = checkImgList.length - 1; i >= 0; i--) {
                checkImg = checkImgList[i];
                label = todoUtils.oldPatch.getLabelFromChild(checkImg);
                if (!label || label.children[0] != checkImg) {
                    todoUtils.fixCheckbox(checkImg, true);
                }
                //将 image 转换为 i
                todoUtils.oldPatch.fixImg(checkImg);
            }

            //处理那些被嵌套的 todoList（错误的 Dom 结构）
            labelList = _commonEnv2['default'].doc.querySelectorAll('.' + _commonConst2['default'].CLASS.TODO_LABEL_OLD);
            for (i = 0; i < labelList.length; i++) {
                label = labelList[i];
                container = todoUtils.oldPatch.packageTodo(label);
                _domUtilsDomExtend2['default'].addClass(container, _commonConst2['default'].CLASS.TODO_LAYER);
                subLabelList = container.querySelectorAll('.' + _commonConst2['default'].CLASS.TODO_LABEL_OLD);
                for (j = subLabelList.length - 1; j > 0; j--) {
                    subLabel = subLabelList[j];
                    subContainer = todoUtils.oldPatch.packageTodo(subLabel);
                    _domUtilsDomExtend2['default'].before(container, subContainer, true);
                }
                //修正 用户信息
                todoUtils.oldPatch.fixUserInfo(label);
            }

            //将 label 全部替换为 span
            labelList = _commonEnv2['default'].doc.querySelectorAll('.' + _commonConst2['default'].CLASS.TODO_LABEL_OLD);
            for (i = labelList.length - 1; i >= 0; i--) {
                todoUtils.oldPatch.fixLabel(labelList[i]);
            }

            //清理 Tail
            tailList = _commonEnv2['default'].doc.querySelectorAll('.' + _commonConst2['default'].CLASS.TODO_TAIL_OLD);
            for (i = tailList.length - 1; i >= 0; i--) {
                tail = tailList[i];
                if (_domUtilsDomExtend2['default'].isEmptyDom(tail)) {
                    tail.parentNode.removeChild(tail);
                } else {
                    _domUtilsDomExtend2['default'].removeClass(_commonConst2['default'].CLASS.TODO_TAIL_OLD);
                }
            }
        },
        fixUserInfo: function fixUserInfo(label) {
            var parent = label.parentNode,
                check = todoUtils.oldPatch.getCheckImg(label),
                id = check ? check.id : '',
                childNodes = parent.childNodes,
                child,
                i,
                firstUserInfo = false;
            for (i = 0; i < childNodes.length; i++) {
                child = childNodes[i];
                if (_domUtilsDomExtend2['default'].hasClass(child, _commonConst2['default'].CLASS.TODO_USER_INFO)) {
                    if (!firstUserInfo) {
                        firstUserInfo = true;
                        child.setAttribute(_commonConst2['default'].ATTR.TODO_ID, id);
                    } else {
                        parent.removeChild(child);
                        i--;
                    }
                }
            }
        },
        getCheckImg: function getCheckImg(label) {
            if (!label) {
                return null;
            }
            return label.querySelector('.' + _commonConst2['default'].CLASS.TODO_CHECK_IMG_OLD);
        },
        getLabelFromChild: function getLabelFromChild(dom) {
            if (!dom) {
                return null;
            }
            return _domUtilsDomExtend2['default'].getParentByFilter(dom, function (dom) {
                return _domUtilsDomExtend2['default'].hasClass(dom, _commonConst2['default'].CLASS.TODO_LABEL_OLD);
            }, true);
        },
        isFirstLabel: function isFirstLabel(label) {
            if (!label) {
                return false;
            }
            var parent = label.parentNode,
                childNodes = parent.childNodes,
                i,
                child;

            for (i = 0; i < childNodes.length; i++) {
                child = childNodes[i];
                if (child === label) {
                    return true;
                } else if (!_domUtilsDomExtend2['default'].isEmptyDom(child)) {
                    return false;
                }
            }
            return false;
        },
        /**
         * 给 todoItem 打包
         * @param label
         * @returns {*}
         */
        packageTodo: function packageTodo(label) {
            if (!label) {
                return null;
            }
            var parent = label.parentNode;

            if (parent !== _commonEnv2['default'].doc.body && todoUtils.oldPatch.isFirstLabel(label)) {
                //如果 label 是首元素，则直接返回 label 的父元素
                return parent;
            }

            // 如果 label 不是首元素，则 对齐进行打包
            var check = todoUtils.oldPatch.getCheckImg(label),
                id = check ? check.id : '',
                userInfo = id ? parent.querySelector('span[' + _commonConst2['default'].ATTR.TODO_ID + '=' + id + ']') : null,
                next = label.nextSibling,
                tmpNext;
            var container = _commonEnv2['default'].doc.createElement('div');
            container.appendChild(label);
            while (next) {
                tmpNext = next.nextSibling;
                container.appendChild(next);
                next = next == userInfo ? null : tmpNext;
            }
            parent.insertBefore(container, tmpNext);
            return container;
        }
    }
};

exports['default'] = todoUtils;
module.exports = exports['default'];

},{"../common/const":13,"../common/env":15,"../common/historyUtils":16,"../common/lang":17,"../common/wizStyle":20,"../domUtils/domExtend":24,"../rangeUtils/rangeExtend":36,"./../common/Base64":12}],46:[function(require,module,exports){
'use strict';

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _commonEnv = require('./common/env');

var _commonEnv2 = _interopRequireDefault(_commonEnv);

// import CONST from './common/const';
// import LANG, {initLang} from './common/lang';
// import utils from './common/utils';

var _domUtilsDomExtend = require('./domUtils/domExtend');

var _domUtilsDomExtend2 = _interopRequireDefault(_domUtilsDomExtend);

// import amend from './amend/amend';

var _commonHistoryUtils = require('./common/historyUtils');

var _commonHistoryUtils2 = _interopRequireDefault(_commonHistoryUtils);

// import Base64 from './common/Base64';

var _rangeUtilsRangeExtend = require('./rangeUtils/rangeExtend');

var _rangeUtilsRangeExtend2 = _interopRequireDefault(_rangeUtilsRangeExtend);

var _tableUtilsTableZone = require('./tableUtils/tableZone');

var _tableUtilsTableZone2 = _interopRequireDefault(_tableUtilsTableZone);

// import linkUtils from './linkUtils/linkUtils';

var _imgUtilsImgUtils = require('./imgUtils/imgUtils');

var _imgUtilsImgUtils2 = _interopRequireDefault(_imgUtilsImgUtils);

// import nightModeUtils from './nightMode/nightModeUtils';
// import editor from './editor/base';
// import editorEvent from './editor/editorEvent';

var _WizEditor = require('./WizEditor');

var _WizEditor2 = _interopRequireDefault(_WizEditor);

var _WizReader = require('./WizReader');

var _WizReader2 = _interopRequireDefault(_WizReader);

var editorInit = _WizEditor2['default'].init;
_WizEditor2['default'].init = function (options) {
    editorInit(options);
    _WizReader2['default'].init();

    return _WizEditor2['default'];
};

},{"./WizEditor":5,"./WizReader":6,"./common/env":15,"./common/historyUtils":16,"./domUtils/domExtend":24,"./imgUtils/imgUtils":29,"./rangeUtils/rangeExtend":36,"./tableUtils/tableZone":42}]},{},[46]);