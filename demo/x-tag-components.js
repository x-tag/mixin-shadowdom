/*
 * Copyright 2012 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

if (typeof WeakMap === 'undefined') {
  (function() {
    var defineProperty = Object.defineProperty;
    var counter = Date.now() % 1e9;

    var WeakMap = function() {
      this.name = '__st' + (Math.random() * 1e9 >>> 0) + (counter++ + '__');
    };

    WeakMap.prototype = {
      set: function(key, value) {
        var entry = key[this.name];
        if (entry && entry[0] === key)
          entry[1] = value;
        else
          defineProperty(key, this.name, {value: [key, value], writable: true});
      },
      get: function(key) {
        var entry;
        return (entry = key[this.name]) && entry[0] === key ?
            entry[1] : undefined;
      },
      delete: function(key) {
        this.set(key, undefined);
      }
    };

    window.WeakMap = WeakMap;
  })();
}

// Copyright 2012 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

(function(global) {
  'use strict';

  // Detect and do basic sanity checking on Object/Array.observe.
  function detectObjectObserve() {
    if (typeof Object.observe !== 'function' ||
        typeof Array.observe !== 'function') {
      return false;
    }

    var records = [];

    function callback(recs) {
      records = recs;
    }

    var test = {};
    var arr = [];
    Object.observe(test, callback);
    Array.observe(arr, callback);
    test.id = 1;
    test.id = 2;
    delete test.id;
    arr.push(1, 2);
    arr.length = 0;

    Object.deliverChangeRecords(callback);
    if (records.length !== 5)
      return false;

    if (records[0].type != 'add' ||
        records[1].type != 'update' ||
        records[2].type != 'delete' ||
        records[3].type != 'splice' ||
        records[4].type != 'splice') {
      return false;
    }

    Object.unobserve(test, callback);
    Array.unobserve(arr, callback);

    return true;
  }

  var hasObserve = detectObjectObserve();

  function detectEval() {
    // don't test for eval if document has CSP securityPolicy object and we can see that
    // eval is not supported. This avoids an error message in console even when the exception
    // is caught
    if (global.document &&
        'securityPolicy' in global.document &&
        !global.document.securityPolicy.allowsEval) {
      return false;
    }

    // Don't test for eval if we're running in a Chrome App environment.
    // We check for APIs set that only exist in a Chrome App context.
    if (typeof chrome !== 'undefined' && chrome.app && chrome.app.runtime) {
      return false;
    }

    try {
      var f = new Function('', 'return true;');
      return f();
    } catch (ex) {
      return false;
    }
  }

  var hasEval = detectEval();

  function isIndex(s) {
    return +s === s >>> 0;
  }

  function toNumber(s) {
    return +s;
  }

  function isObject(obj) {
    return obj === Object(obj);
  }

  var numberIsNaN = global.Number.isNaN || function isNaN(value) {
    return typeof value === 'number' && global.isNaN(value);
  }

  function areSameValue(left, right) {
    if (left === right)
      return left !== 0 || 1 / left === 1 / right;
    if (numberIsNaN(left) && numberIsNaN(right))
      return true;

    return left !== left && right !== right;
  }

  var createObject = ('__proto__' in {}) ?
    function(obj) { return obj; } :
    function(obj) {
      var proto = obj.__proto__;
      if (!proto)
        return obj;
      var newObject = Object.create(proto);
      Object.getOwnPropertyNames(obj).forEach(function(name) {
        Object.defineProperty(newObject, name,
                             Object.getOwnPropertyDescriptor(obj, name));
      });
      return newObject;
    };

  var identStart = '[\$_a-zA-Z]';
  var identPart = '[\$_a-zA-Z0-9]';
  var ident = identStart + '+' + identPart + '*';
  var elementIndex = '(?:[0-9]|[1-9]+[0-9]+)';
  var identOrElementIndex = '(?:' + ident + '|' + elementIndex + ')';
  var path = '(?:' + identOrElementIndex + ')(?:\\s*\\.\\s*' + identOrElementIndex + ')*';
  var pathRegExp = new RegExp('^' + path + '$');

  function isPathValid(s) {
    if (typeof s != 'string')
      return false;
    s = s.trim();

    if (s == '')
      return true;

    if (s[0] == '.')
      return false;

    return pathRegExp.test(s);
  }

  var constructorIsPrivate = {};

  function Path(s, privateToken) {
    if (privateToken !== constructorIsPrivate)
      throw Error('Use Path.get to retrieve path objects');

    if (s.trim() == '')
      return this;

    if (isIndex(s)) {
      this.push(s);
      return this;
    }

    s.split(/\s*\.\s*/).filter(function(part) {
      return part;
    }).forEach(function(part) {
      this.push(part);
    }, this);

    if (hasEval && this.length) {
      this.getValueFrom = this.compiledGetValueFromFn();
    }
  }

  // TODO(rafaelw): Make simple LRU cache
  var pathCache = {};

  function getPath(pathString) {
    if (pathString instanceof Path)
      return pathString;

    if (pathString == null)
      pathString = '';

    if (typeof pathString !== 'string')
      pathString = String(pathString);

    var path = pathCache[pathString];
    if (path)
      return path;
    if (!isPathValid(pathString))
      return invalidPath;
    var path = new Path(pathString, constructorIsPrivate);
    pathCache[pathString] = path;
    return path;
  }

  Path.get = getPath;

  Path.prototype = createObject({
    __proto__: [],
    valid: true,

    toString: function() {
      return this.join('.');
    },

    getValueFrom: function(obj, directObserver) {
      for (var i = 0; i < this.length; i++) {
        if (obj == null)
          return;
        obj = obj[this[i]];
      }
      return obj;
    },

    iterateObjects: function(obj, observe) {
      for (var i = 0; i < this.length; i++) {
        if (i)
          obj = obj[this[i - 1]];
        if (!isObject(obj))
          return;
        observe(obj, this[0]);
      }
    },

    compiledGetValueFromFn: function() {
      var accessors = this.map(function(ident) {
        return isIndex(ident) ? '["' + ident + '"]' : '.' + ident;
      });

      var str = '';
      var pathString = 'obj';
      str += 'if (obj != null';
      var i = 0;
      for (; i < (this.length - 1); i++) {
        var ident = this[i];
        pathString += accessors[i];
        str += ' &&\n     ' + pathString + ' != null';
      }
      str += ')\n';

      pathString += accessors[i];

      str += '  return ' + pathString + ';\nelse\n  return undefined;';
      return new Function('obj', str);
    },

    setValueFrom: function(obj, value) {
      if (!this.length)
        return false;

      for (var i = 0; i < this.length - 1; i++) {
        if (!isObject(obj))
          return false;
        obj = obj[this[i]];
      }

      if (!isObject(obj))
        return false;

      obj[this[i]] = value;
      return true;
    }
  });

  var invalidPath = new Path('', constructorIsPrivate);
  invalidPath.valid = false;
  invalidPath.getValueFrom = invalidPath.setValueFrom = function() {};

  var MAX_DIRTY_CHECK_CYCLES = 1000;

  function dirtyCheck(observer) {
    var cycles = 0;
    while (cycles < MAX_DIRTY_CHECK_CYCLES && observer.check_()) {
      cycles++;
    }
    if (global.testingExposeCycleCount)
      global.dirtyCheckCycleCount = cycles;

    return cycles > 0;
  }

  function objectIsEmpty(object) {
    for (var prop in object)
      return false;
    return true;
  }

  function diffIsEmpty(diff) {
    return objectIsEmpty(diff.added) &&
           objectIsEmpty(diff.removed) &&
           objectIsEmpty(diff.changed);
  }

  function diffObjectFromOldObject(object, oldObject) {
    var added = {};
    var removed = {};
    var changed = {};

    for (var prop in oldObject) {
      var newValue = object[prop];

      if (newValue !== undefined && newValue === oldObject[prop])
        continue;

      if (!(prop in object)) {
        removed[prop] = undefined;
        continue;
      }

      if (newValue !== oldObject[prop])
        changed[prop] = newValue;
    }

    for (var prop in object) {
      if (prop in oldObject)
        continue;

      added[prop] = object[prop];
    }

    if (Array.isArray(object) && object.length !== oldObject.length)
      changed.length = object.length;

    return {
      added: added,
      removed: removed,
      changed: changed
    };
  }

  var eomTasks = [];
  function runEOMTasks() {
    if (!eomTasks.length)
      return false;

    for (var i = 0; i < eomTasks.length; i++) {
      eomTasks[i]();
    }
    eomTasks.length = 0;
    return true;
  }

  var runEOM = hasObserve ? (function(){
    var eomObj = { pingPong: true };
    var eomRunScheduled = false;

    Object.observe(eomObj, function() {
      runEOMTasks();
      eomRunScheduled = false;
    });

    return function(fn) {
      eomTasks.push(fn);
      if (!eomRunScheduled) {
        eomRunScheduled = true;
        eomObj.pingPong = !eomObj.pingPong;
      }
    };
  })() :
  (function() {
    return function(fn) {
      eomTasks.push(fn);
    };
  })();

  var observedObjectCache = [];

  function newObservedObject() {
    var observer;
    var object;
    var discardRecords = false;
    var first = true;

    function callback(records) {
      if (observer && observer.state_ === OPENED && !discardRecords)
        observer.check_(records);
    }

    return {
      open: function(obs) {
        if (observer)
          throw Error('ObservedObject in use');

        if (!first)
          Object.deliverChangeRecords(callback);

        observer = obs;
        first = false;
      },
      observe: function(obj, arrayObserve) {
        object = obj;
        if (arrayObserve)
          Array.observe(object, callback);
        else
          Object.observe(object, callback);
      },
      deliver: function(discard) {
        discardRecords = discard;
        Object.deliverChangeRecords(callback);
        discardRecords = false;
      },
      close: function() {
        observer = undefined;
        Object.unobserve(object, callback);
        observedObjectCache.push(this);
      }
    };
  }

  /*
   * The observedSet abstraction is a perf optimization which reduces the total
   * number of Object.observe observations of a set of objects. The idea is that
   * groups of Observers will have some object dependencies in common and this
   * observed set ensures that each object in the transitive closure of
   * dependencies is only observed once. The observedSet acts as a write barrier
   * such that whenever any change comes through, all Observers are checked for
   * changed values.
   *
   * Note that this optimization is explicitly moving work from setup-time to
   * change-time.
   *
   * TODO(rafaelw): Implement "garbage collection". In order to move work off
   * the critical path, when Observers are closed, their observed objects are
   * not Object.unobserve(d). As a result, it's possible that if the observedSet
   * is kept open, but some Observers have been closed, it could cause "leaks"
   * (prevent otherwise collectable objects from being collected). At some
   * point, we should implement incremental "gc" which keeps a list of
   * observedSets which may need clean-up and does small amounts of cleanup on a
   * timeout until all is clean.
   */

  function getObservedObject(observer, object, arrayObserve) {
    var dir = observedObjectCache.pop() || newObservedObject();
    dir.open(observer);
    dir.observe(object, arrayObserve);
    return dir;
  }

  var observedSetCache = [];

  function newObservedSet() {
    var observerCount = 0;
    var observers = [];
    var objects = [];
    var rootObj;
    var rootObjProps;

    function observe(obj, prop) {
      if (!obj)
        return;

      if (obj === rootObj)
        rootObjProps[prop] = true;

      if (objects.indexOf(obj) < 0) {
        objects.push(obj);
        Object.observe(obj, callback);
      }

      observe(Object.getPrototypeOf(obj), prop);
    }

    function allRootObjNonObservedProps(recs) {
      for (var i = 0; i < recs.length; i++) {
        var rec = recs[i];
        if (rec.object !== rootObj ||
            rootObjProps[rec.name] ||
            rec.type === 'setPrototype') {
          return false;
        }
      }
      return true;
    }

    function callback(recs) {
      if (allRootObjNonObservedProps(recs))
        return;

      var observer;
      for (var i = 0; i < observers.length; i++) {
        observer = observers[i];
        if (observer.state_ == OPENED) {
          observer.iterateObjects_(observe);
        }
      }

      for (var i = 0; i < observers.length; i++) {
        observer = observers[i];
        if (observer.state_ == OPENED) {
          observer.check_();
        }
      }
    }

    var record = {
      object: undefined,
      objects: objects,
      open: function(obs, object) {
        if (!rootObj) {
          rootObj = object;
          rootObjProps = {};
        }

        observers.push(obs);
        observerCount++;
        obs.iterateObjects_(observe);
      },
      close: function(obs) {
        observerCount--;
        if (observerCount > 0) {
          return;
        }

        for (var i = 0; i < objects.length; i++) {
          Object.unobserve(objects[i], callback);
          Observer.unobservedCount++;
        }

        observers.length = 0;
        objects.length = 0;
        rootObj = undefined;
        rootObjProps = undefined;
        observedSetCache.push(this);
      }
    };

    return record;
  }

  var lastObservedSet;

  function getObservedSet(observer, obj) {
    if (!lastObservedSet || lastObservedSet.object !== obj) {
      lastObservedSet = observedSetCache.pop() || newObservedSet();
      lastObservedSet.object = obj;
    }
    lastObservedSet.open(observer, obj);
    return lastObservedSet;
  }

  var UNOPENED = 0;
  var OPENED = 1;
  var CLOSED = 2;
  var RESETTING = 3;

  var nextObserverId = 1;

  function Observer() {
    this.state_ = UNOPENED;
    this.callback_ = undefined;
    this.target_ = undefined; // TODO(rafaelw): Should be WeakRef
    this.directObserver_ = undefined;
    this.value_ = undefined;
    this.id_ = nextObserverId++;
  }

  Observer.prototype = {
    open: function(callback, target) {
      if (this.state_ != UNOPENED)
        throw Error('Observer has already been opened.');

      addToAll(this);
      this.callback_ = callback;
      this.target_ = target;
      this.connect_();
      this.state_ = OPENED;
      return this.value_;
    },

    close: function() {
      if (this.state_ != OPENED)
        return;

      removeFromAll(this);
      this.disconnect_();
      this.value_ = undefined;
      this.callback_ = undefined;
      this.target_ = undefined;
      this.state_ = CLOSED;
    },

    deliver: function() {
      if (this.state_ != OPENED)
        return;

      dirtyCheck(this);
    },

    report_: function(changes) {
      try {
        this.callback_.apply(this.target_, changes);
      } catch (ex) {
        Observer._errorThrownDuringCallback = true;
        console.error('Exception caught during observer callback: ' +
                       (ex.stack || ex));
      }
    },

    discardChanges: function() {
      this.check_(undefined, true);
      return this.value_;
    }
  }

  var collectObservers = !hasObserve;
  var allObservers;
  Observer._allObserversCount = 0;

  if (collectObservers) {
    allObservers = [];
  }

  function addToAll(observer) {
    Observer._allObserversCount++;
    if (!collectObservers)
      return;

    allObservers.push(observer);
  }

  function removeFromAll(observer) {
    Observer._allObserversCount--;
  }

  var runningMicrotaskCheckpoint = false;

  var hasDebugForceFullDelivery = hasObserve && (function() {
    try {
      eval('%RunMicrotasks()');
      return true;
    } catch (ex) {
      return false;
    }
  })();

  global.Platform = global.Platform || {};

  global.Platform.performMicrotaskCheckpoint = function() {
    if (runningMicrotaskCheckpoint)
      return;

    if (hasDebugForceFullDelivery) {
      eval('%RunMicrotasks()');
      return;
    }

    if (!collectObservers)
      return;

    runningMicrotaskCheckpoint = true;

    var cycles = 0;
    var anyChanged, toCheck;

    do {
      cycles++;
      toCheck = allObservers;
      allObservers = [];
      anyChanged = false;

      for (var i = 0; i < toCheck.length; i++) {
        var observer = toCheck[i];
        if (observer.state_ != OPENED)
          continue;

        if (observer.check_())
          anyChanged = true;

        allObservers.push(observer);
      }
      if (runEOMTasks())
        anyChanged = true;
    } while (cycles < MAX_DIRTY_CHECK_CYCLES && anyChanged);

    if (global.testingExposeCycleCount)
      global.dirtyCheckCycleCount = cycles;

    runningMicrotaskCheckpoint = false;
  };

  if (collectObservers) {
    global.Platform.clearObservers = function() {
      allObservers = [];
    };
  }

  function ObjectObserver(object) {
    Observer.call(this);
    this.value_ = object;
    this.oldObject_ = undefined;
  }

  ObjectObserver.prototype = createObject({
    __proto__: Observer.prototype,

    arrayObserve: false,

    connect_: function(callback, target) {
      if (hasObserve) {
        this.directObserver_ = getObservedObject(this, this.value_,
                                                 this.arrayObserve);
      } else {
        this.oldObject_ = this.copyObject(this.value_);
      }

    },

    copyObject: function(object) {
      var copy = Array.isArray(object) ? [] : {};
      for (var prop in object) {
        copy[prop] = object[prop];
      };
      if (Array.isArray(object))
        copy.length = object.length;
      return copy;
    },

    check_: function(changeRecords, skipChanges) {
      var diff;
      var oldValues;
      if (hasObserve) {
        if (!changeRecords)
          return false;

        oldValues = {};
        diff = diffObjectFromChangeRecords(this.value_, changeRecords,
                                           oldValues);
      } else {
        oldValues = this.oldObject_;
        diff = diffObjectFromOldObject(this.value_, this.oldObject_);
      }

      if (diffIsEmpty(diff))
        return false;

      if (!hasObserve)
        this.oldObject_ = this.copyObject(this.value_);

      this.report_([
        diff.added || {},
        diff.removed || {},
        diff.changed || {},
        function(property) {
          return oldValues[property];
        }
      ]);

      return true;
    },

    disconnect_: function() {
      if (hasObserve) {
        this.directObserver_.close();
        this.directObserver_ = undefined;
      } else {
        this.oldObject_ = undefined;
      }
    },

    deliver: function() {
      if (this.state_ != OPENED)
        return;

      if (hasObserve)
        this.directObserver_.deliver(false);
      else
        dirtyCheck(this);
    },

    discardChanges: function() {
      if (this.directObserver_)
        this.directObserver_.deliver(true);
      else
        this.oldObject_ = this.copyObject(this.value_);

      return this.value_;
    }
  });

  function ArrayObserver(array) {
    if (!Array.isArray(array))
      throw Error('Provided object is not an Array');
    ObjectObserver.call(this, array);
  }

  ArrayObserver.prototype = createObject({

    __proto__: ObjectObserver.prototype,

    arrayObserve: true,

    copyObject: function(arr) {
      return arr.slice();
    },

    check_: function(changeRecords) {
      var splices;
      if (hasObserve) {
        if (!changeRecords)
          return false;
        splices = projectArraySplices(this.value_, changeRecords);
      } else {
        splices = calcSplices(this.value_, 0, this.value_.length,
                              this.oldObject_, 0, this.oldObject_.length);
      }

      if (!splices || !splices.length)
        return false;

      if (!hasObserve)
        this.oldObject_ = this.copyObject(this.value_);

      this.report_([splices]);
      return true;
    }
  });

  ArrayObserver.applySplices = function(previous, current, splices) {
    splices.forEach(function(splice) {
      var spliceArgs = [splice.index, splice.removed.length];
      var addIndex = splice.index;
      while (addIndex < splice.index + splice.addedCount) {
        spliceArgs.push(current[addIndex]);
        addIndex++;
      }

      Array.prototype.splice.apply(previous, spliceArgs);
    });
  };

  function PathObserver(object, path) {
    Observer.call(this);

    this.object_ = object;
    this.path_ = getPath(path);
    this.directObserver_ = undefined;
  }

  PathObserver.prototype = createObject({
    __proto__: Observer.prototype,

    connect_: function() {
      if (hasObserve)
        this.directObserver_ = getObservedSet(this, this.object_);

      this.check_(undefined, true);
    },

    disconnect_: function() {
      this.value_ = undefined;

      if (this.directObserver_) {
        this.directObserver_.close(this);
        this.directObserver_ = undefined;
      }
    },

    iterateObjects_: function(observe) {
      this.path_.iterateObjects(this.object_, observe);
    },

    check_: function(changeRecords, skipChanges) {
      var oldValue = this.value_;
      this.value_ = this.path_.getValueFrom(this.object_);
      if (skipChanges || areSameValue(this.value_, oldValue))
        return false;

      this.report_([this.value_, oldValue]);
      return true;
    },

    setValue: function(newValue) {
      if (this.path_)
        this.path_.setValueFrom(this.object_, newValue);
    }
  });

  function CompoundObserver(reportChangesOnOpen) {
    Observer.call(this);

    this.reportChangesOnOpen_ = reportChangesOnOpen;
    this.value_ = [];
    this.directObserver_ = undefined;
    this.observed_ = [];
  }

  var observerSentinel = {};

  CompoundObserver.prototype = createObject({
    __proto__: Observer.prototype,

    connect_: function() {
      if (hasObserve) {
        var object;
        var needsDirectObserver = false;
        for (var i = 0; i < this.observed_.length; i += 2) {
          object = this.observed_[i]
          if (object !== observerSentinel) {
            needsDirectObserver = true;
            break;
          }
        }

        if (needsDirectObserver)
          this.directObserver_ = getObservedSet(this, object);
      }

      this.check_(undefined, !this.reportChangesOnOpen_);
    },

    disconnect_: function() {
      for (var i = 0; i < this.observed_.length; i += 2) {
        if (this.observed_[i] === observerSentinel)
          this.observed_[i + 1].close();
      }
      this.observed_.length = 0;
      this.value_.length = 0;

      if (this.directObserver_) {
        this.directObserver_.close(this);
        this.directObserver_ = undefined;
      }
    },

    addPath: function(object, path) {
      if (this.state_ != UNOPENED && this.state_ != RESETTING)
        throw Error('Cannot add paths once started.');

      var path = getPath(path);
      this.observed_.push(object, path);
      if (!this.reportChangesOnOpen_)
        return;
      var index = this.observed_.length / 2 - 1;
      this.value_[index] = path.getValueFrom(object);
    },

    addObserver: function(observer) {
      if (this.state_ != UNOPENED && this.state_ != RESETTING)
        throw Error('Cannot add observers once started.');

      this.observed_.push(observerSentinel, observer);
      if (!this.reportChangesOnOpen_)
        return;
      var index = this.observed_.length / 2 - 1;
      this.value_[index] = observer.open(this.deliver, this);
    },

    startReset: function() {
      if (this.state_ != OPENED)
        throw Error('Can only reset while open');

      this.state_ = RESETTING;
      this.disconnect_();
    },

    finishReset: function() {
      if (this.state_ != RESETTING)
        throw Error('Can only finishReset after startReset');
      this.state_ = OPENED;
      this.connect_();

      return this.value_;
    },

    iterateObjects_: function(observe) {
      var object;
      for (var i = 0; i < this.observed_.length; i += 2) {
        object = this.observed_[i]
        if (object !== observerSentinel)
          this.observed_[i + 1].iterateObjects(object, observe)
      }
    },

    check_: function(changeRecords, skipChanges) {
      var oldValues;
      for (var i = 0; i < this.observed_.length; i += 2) {
        var object = this.observed_[i];
        var path = this.observed_[i+1];
        var value;
        if (object === observerSentinel) {
          var observable = path;
          value = this.state_ === UNOPENED ?
              observable.open(this.deliver, this) :
              observable.discardChanges();
        } else {
          value = path.getValueFrom(object);
        }

        if (skipChanges) {
          this.value_[i / 2] = value;
          continue;
        }

        if (areSameValue(value, this.value_[i / 2]))
          continue;

        oldValues = oldValues || [];
        oldValues[i / 2] = this.value_[i / 2];
        this.value_[i / 2] = value;
      }

      if (!oldValues)
        return false;

      // TODO(rafaelw): Having observed_ as the third callback arg here is
      // pretty lame API. Fix.
      this.report_([this.value_, oldValues, this.observed_]);
      return true;
    }
  });

  function identFn(value) { return value; }

  function ObserverTransform(observable, getValueFn, setValueFn,
                             dontPassThroughSet) {
    this.callback_ = undefined;
    this.target_ = undefined;
    this.value_ = undefined;
    this.observable_ = observable;
    this.getValueFn_ = getValueFn || identFn;
    this.setValueFn_ = setValueFn || identFn;
    // TODO(rafaelw): This is a temporary hack. PolymerExpressions needs this
    // at the moment because of a bug in it's dependency tracking.
    this.dontPassThroughSet_ = dontPassThroughSet;
  }

  ObserverTransform.prototype = {
    open: function(callback, target) {
      this.callback_ = callback;
      this.target_ = target;
      this.value_ =
          this.getValueFn_(this.observable_.open(this.observedCallback_, this));
      return this.value_;
    },

    observedCallback_: function(value) {
      value = this.getValueFn_(value);
      if (areSameValue(value, this.value_))
        return;
      var oldValue = this.value_;
      this.value_ = value;
      this.callback_.call(this.target_, this.value_, oldValue);
    },

    discardChanges: function() {
      this.value_ = this.getValueFn_(this.observable_.discardChanges());
      return this.value_;
    },

    deliver: function() {
      return this.observable_.deliver();
    },

    setValue: function(value) {
      value = this.setValueFn_(value);
      if (!this.dontPassThroughSet_ && this.observable_.setValue)
        return this.observable_.setValue(value);
    },

    close: function() {
      if (this.observable_)
        this.observable_.close();
      this.callback_ = undefined;
      this.target_ = undefined;
      this.observable_ = undefined;
      this.value_ = undefined;
      this.getValueFn_ = undefined;
      this.setValueFn_ = undefined;
    }
  }

  var expectedRecordTypes = {
    add: true,
    update: true,
    delete: true
  };

 var updateRecord = {
    object: undefined,
    type: 'update',
    name: undefined,
    oldValue: undefined
  };

  function notify(object, name, value, oldValue) {
    if (areSameValue(value, oldValue))
      return;

    // TODO(rafaelw): Hack hack hack. This entire code really needs to move
    // out of observe-js into polymer.
    if (typeof object.propertyChanged_ == 'function')
      object.propertyChanged_(name, value, oldValue);

    if (!hasObserve)
      return;

    var notifier = object.notifier_;
    if (!notifier)
      notifier = object.notifier_ = Object.getNotifier(object);

    updateRecord.object = object;
    updateRecord.name = name;
    updateRecord.oldValue = oldValue;

    notifier.notify(updateRecord);
  }

  Observer.createBindablePrototypeAccessor = function(proto, name) {
    var privateName = name + '_';
    var privateObservable  = name + 'Observable_';

    proto[privateName] = proto[name];

    Object.defineProperty(proto, name, {
      get: function() {
        var observable = this[privateObservable];
        if (observable)
          observable.deliver();

        return this[privateName];
      },
      set: function(value) {
        var observable = this[privateObservable];
        if (observable) {
          observable.setValue(value);
          return;
        }

        var oldValue = this[privateName];
        this[privateName] = value;
        notify(this, name, value, oldValue);

        return value;
      },
      configurable: true
    });
  }

  Observer.bindToInstance = function(instance, name, observable, resolveFn) {
    var privateName = name + '_';
    var privateObservable  = name + 'Observable_';

    instance[privateObservable] = observable;
    var oldValue = instance[privateName];
    var value = observable.open(function(value, oldValue) {
      instance[privateName] = value;
      notify(instance, name, value, oldValue);
    });

    if (resolveFn && !areSameValue(oldValue, value)) {
      var resolvedValue = resolveFn(oldValue, value);
      if (!areSameValue(value, resolvedValue)) {
        value = resolvedValue;
        if (observable.setValue)
          observable.setValue(value);
      }
    }

    instance[privateName] = value;
    notify(instance, name, value, oldValue);

    return {
      close: function() {
        observable.close();
        instance[privateObservable] = undefined;
      }
    };
  }

  function diffObjectFromChangeRecords(object, changeRecords, oldValues) {
    var added = {};
    var removed = {};

    for (var i = 0; i < changeRecords.length; i++) {
      var record = changeRecords[i];
      if (!expectedRecordTypes[record.type]) {
        console.error('Unknown changeRecord type: ' + record.type);
        console.error(record);
        continue;
      }

      if (!(record.name in oldValues))
        oldValues[record.name] = record.oldValue;

      if (record.type == 'update')
        continue;

      if (record.type == 'add') {
        if (record.name in removed)
          delete removed[record.name];
        else
          added[record.name] = true;

        continue;
      }

      // type = 'delete'
      if (record.name in added) {
        delete added[record.name];
        delete oldValues[record.name];
      } else {
        removed[record.name] = true;
      }
    }

    for (var prop in added)
      added[prop] = object[prop];

    for (var prop in removed)
      removed[prop] = undefined;

    var changed = {};
    for (var prop in oldValues) {
      if (prop in added || prop in removed)
        continue;

      var newValue = object[prop];
      if (oldValues[prop] !== newValue)
        changed[prop] = newValue;
    }

    return {
      added: added,
      removed: removed,
      changed: changed
    };
  }

  function newSplice(index, removed, addedCount) {
    return {
      index: index,
      removed: removed,
      addedCount: addedCount
    };
  }

  var EDIT_LEAVE = 0;
  var EDIT_UPDATE = 1;
  var EDIT_ADD = 2;
  var EDIT_DELETE = 3;

  function ArraySplice() {}

  ArraySplice.prototype = {

    // Note: This function is *based* on the computation of the Levenshtein
    // "edit" distance. The one change is that "updates" are treated as two
    // edits - not one. With Array splices, an update is really a delete
    // followed by an add. By retaining this, we optimize for "keeping" the
    // maximum array items in the original array. For example:
    //
    //   'xxxx123' -> '123yyyy'
    //
    // With 1-edit updates, the shortest path would be just to update all seven
    // characters. With 2-edit updates, we delete 4, leave 3, and add 4. This
    // leaves the substring '123' intact.
    calcEditDistances: function(current, currentStart, currentEnd,
                                old, oldStart, oldEnd) {
      // "Deletion" columns
      var rowCount = oldEnd - oldStart + 1;
      var columnCount = currentEnd - currentStart + 1;
      var distances = new Array(rowCount);

      // "Addition" rows. Initialize null column.
      for (var i = 0; i < rowCount; i++) {
        distances[i] = new Array(columnCount);
        distances[i][0] = i;
      }

      // Initialize null row
      for (var j = 0; j < columnCount; j++)
        distances[0][j] = j;

      for (var i = 1; i < rowCount; i++) {
        for (var j = 1; j < columnCount; j++) {
          if (this.equals(current[currentStart + j - 1], old[oldStart + i - 1]))
            distances[i][j] = distances[i - 1][j - 1];
          else {
            var north = distances[i - 1][j] + 1;
            var west = distances[i][j - 1] + 1;
            distances[i][j] = north < west ? north : west;
          }
        }
      }

      return distances;
    },

    // This starts at the final weight, and walks "backward" by finding
    // the minimum previous weight recursively until the origin of the weight
    // matrix.
    spliceOperationsFromEditDistances: function(distances) {
      var i = distances.length - 1;
      var j = distances[0].length - 1;
      var current = distances[i][j];
      var edits = [];
      while (i > 0 || j > 0) {
        if (i == 0) {
          edits.push(EDIT_ADD);
          j--;
          continue;
        }
        if (j == 0) {
          edits.push(EDIT_DELETE);
          i--;
          continue;
        }
        var northWest = distances[i - 1][j - 1];
        var west = distances[i - 1][j];
        var north = distances[i][j - 1];

        var min;
        if (west < north)
          min = west < northWest ? west : northWest;
        else
          min = north < northWest ? north : northWest;

        if (min == northWest) {
          if (northWest == current) {
            edits.push(EDIT_LEAVE);
          } else {
            edits.push(EDIT_UPDATE);
            current = northWest;
          }
          i--;
          j--;
        } else if (min == west) {
          edits.push(EDIT_DELETE);
          i--;
          current = west;
        } else {
          edits.push(EDIT_ADD);
          j--;
          current = north;
        }
      }

      edits.reverse();
      return edits;
    },

    /**
     * Splice Projection functions:
     *
     * A splice map is a representation of how a previous array of items
     * was transformed into a new array of items. Conceptually it is a list of
     * tuples of
     *
     *   <index, removed, addedCount>
     *
     * which are kept in ascending index order of. The tuple represents that at
     * the |index|, |removed| sequence of items were removed, and counting forward
     * from |index|, |addedCount| items were added.
     */

    /**
     * Lacking individual splice mutation information, the minimal set of
     * splices can be synthesized given the previous state and final state of an
     * array. The basic approach is to calculate the edit distance matrix and
     * choose the shortest path through it.
     *
     * Complexity: O(l * p)
     *   l: The length of the current array
     *   p: The length of the old array
     */
    calcSplices: function(current, currentStart, currentEnd,
                          old, oldStart, oldEnd) {
      var prefixCount = 0;
      var suffixCount = 0;

      var minLength = Math.min(currentEnd - currentStart, oldEnd - oldStart);
      if (currentStart == 0 && oldStart == 0)
        prefixCount = this.sharedPrefix(current, old, minLength);

      if (currentEnd == current.length && oldEnd == old.length)
        suffixCount = this.sharedSuffix(current, old, minLength - prefixCount);

      currentStart += prefixCount;
      oldStart += prefixCount;
      currentEnd -= suffixCount;
      oldEnd -= suffixCount;

      if (currentEnd - currentStart == 0 && oldEnd - oldStart == 0)
        return [];

      if (currentStart == currentEnd) {
        var splice = newSplice(currentStart, [], 0);
        while (oldStart < oldEnd)
          splice.removed.push(old[oldStart++]);

        return [ splice ];
      } else if (oldStart == oldEnd)
        return [ newSplice(currentStart, [], currentEnd - currentStart) ];

      var ops = this.spliceOperationsFromEditDistances(
          this.calcEditDistances(current, currentStart, currentEnd,
                                 old, oldStart, oldEnd));

      var splice = undefined;
      var splices = [];
      var index = currentStart;
      var oldIndex = oldStart;
      for (var i = 0; i < ops.length; i++) {
        switch(ops[i]) {
          case EDIT_LEAVE:
            if (splice) {
              splices.push(splice);
              splice = undefined;
            }

            index++;
            oldIndex++;
            break;
          case EDIT_UPDATE:
            if (!splice)
              splice = newSplice(index, [], 0);

            splice.addedCount++;
            index++;

            splice.removed.push(old[oldIndex]);
            oldIndex++;
            break;
          case EDIT_ADD:
            if (!splice)
              splice = newSplice(index, [], 0);

            splice.addedCount++;
            index++;
            break;
          case EDIT_DELETE:
            if (!splice)
              splice = newSplice(index, [], 0);

            splice.removed.push(old[oldIndex]);
            oldIndex++;
            break;
        }
      }

      if (splice) {
        splices.push(splice);
      }
      return splices;
    },

    sharedPrefix: function(current, old, searchLength) {
      for (var i = 0; i < searchLength; i++)
        if (!this.equals(current[i], old[i]))
          return i;
      return searchLength;
    },

    sharedSuffix: function(current, old, searchLength) {
      var index1 = current.length;
      var index2 = old.length;
      var count = 0;
      while (count < searchLength && this.equals(current[--index1], old[--index2]))
        count++;

      return count;
    },

    calculateSplices: function(current, previous) {
      return this.calcSplices(current, 0, current.length, previous, 0,
                              previous.length);
    },

    equals: function(currentValue, previousValue) {
      return currentValue === previousValue;
    }
  };

  var arraySplice = new ArraySplice();

  function calcSplices(current, currentStart, currentEnd,
                       old, oldStart, oldEnd) {
    return arraySplice.calcSplices(current, currentStart, currentEnd,
                                   old, oldStart, oldEnd);
  }

  function intersect(start1, end1, start2, end2) {
    // Disjoint
    if (end1 < start2 || end2 < start1)
      return -1;

    // Adjacent
    if (end1 == start2 || end2 == start1)
      return 0;

    // Non-zero intersect, span1 first
    if (start1 < start2) {
      if (end1 < end2)
        return end1 - start2; // Overlap
      else
        return end2 - start2; // Contained
    } else {
      // Non-zero intersect, span2 first
      if (end2 < end1)
        return end2 - start1; // Overlap
      else
        return end1 - start1; // Contained
    }
  }

  function mergeSplice(splices, index, removed, addedCount) {

    var splice = newSplice(index, removed, addedCount);

    var inserted = false;
    var insertionOffset = 0;

    for (var i = 0; i < splices.length; i++) {
      var current = splices[i];
      current.index += insertionOffset;

      if (inserted)
        continue;

      var intersectCount = intersect(splice.index,
                                     splice.index + splice.removed.length,
                                     current.index,
                                     current.index + current.addedCount);

      if (intersectCount >= 0) {
        // Merge the two splices

        splices.splice(i, 1);
        i--;

        insertionOffset -= current.addedCount - current.removed.length;

        splice.addedCount += current.addedCount - intersectCount;
        var deleteCount = splice.removed.length +
                          current.removed.length - intersectCount;

        if (!splice.addedCount && !deleteCount) {
          // merged splice is a noop. discard.
          inserted = true;
        } else {
          var removed = current.removed;

          if (splice.index < current.index) {
            // some prefix of splice.removed is prepended to current.removed.
            var prepend = splice.removed.slice(0, current.index - splice.index);
            Array.prototype.push.apply(prepend, removed);
            removed = prepend;
          }

          if (splice.index + splice.removed.length > current.index + current.addedCount) {
            // some suffix of splice.removed is appended to current.removed.
            var append = splice.removed.slice(current.index + current.addedCount - splice.index);
            Array.prototype.push.apply(removed, append);
          }

          splice.removed = removed;
          if (current.index < splice.index) {
            splice.index = current.index;
          }
        }
      } else if (splice.index < current.index) {
        // Insert splice here.

        inserted = true;

        splices.splice(i, 0, splice);
        i++;

        var offset = splice.addedCount - splice.removed.length
        current.index += offset;
        insertionOffset += offset;
      }
    }

    if (!inserted)
      splices.push(splice);
  }

  function createInitialSplices(array, changeRecords) {
    var splices = [];

    for (var i = 0; i < changeRecords.length; i++) {
      var record = changeRecords[i];
      switch(record.type) {
        case 'splice':
          mergeSplice(splices, record.index, record.removed.slice(), record.addedCount);
          break;
        case 'add':
        case 'update':
        case 'delete':
          if (!isIndex(record.name))
            continue;
          var index = toNumber(record.name);
          if (index < 0)
            continue;
          mergeSplice(splices, index, [record.oldValue], 1);
          break;
        default:
          console.error('Unexpected record type: ' + JSON.stringify(record));
          break;
      }
    }

    return splices;
  }

  function projectArraySplices(array, changeRecords) {
    var splices = [];

    createInitialSplices(array, changeRecords).forEach(function(splice) {
      if (splice.addedCount == 1 && splice.removed.length == 1) {
        if (splice.removed[0] !== array[splice.index])
          splices.push(splice);

        return
      };

      splices = splices.concat(calcSplices(array, splice.index, splice.index + splice.addedCount,
                                           splice.removed, 0, splice.removed.length));
    });

    return splices;
  }

  global.Observer = Observer;
  global.Observer.runEOM_ = runEOM;
  global.Observer.observerSentinel_ = observerSentinel; // for testing.
  global.Observer.hasObjectObserve = hasObserve;
  global.ArrayObserver = ArrayObserver;
  global.ArrayObserver.calculateSplices = function(current, previous) {
    return arraySplice.calculateSplices(current, previous);
  };

  global.ArraySplice = ArraySplice;
  global.ObjectObserver = ObjectObserver;
  global.PathObserver = PathObserver;
  global.CompoundObserver = CompoundObserver;
  global.Path = Path;
  global.ObserverTransform = ObserverTransform;
})(typeof global !== 'undefined' && global && typeof module !== 'undefined' && module ? global : this || window);

// Copyright 2012 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

window.ShadowDOMPolyfill = {};

(function(scope) {
  'use strict';

  var constructorTable = new WeakMap();
  var nativePrototypeTable = new WeakMap();
  var wrappers = Object.create(null);

  // Don't test for eval if document has CSP securityPolicy object and we can
  // see that eval is not supported. This avoids an error message in console
  // even when the exception is caught
  var hasEval = !('securityPolicy' in document) ||
      document.securityPolicy.allowsEval;

  if (typeof chrome !== 'undefined' && chrome.app && chrome.app.runtime) {
    hasEval = false;
  }

  if (hasEval) {
    try {
      var f = new Function('', 'return true;');
      hasEval = f();
    } catch (ex) {
      hasEval = false;
    }
  }

  function assert(b) {
    if (!b)
      throw new Error('Assertion failed');
  };

  var defineProperty = Object.defineProperty;
  var getOwnPropertyNames = Object.getOwnPropertyNames;
  var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

  function mixin(to, from) {
    var names = getOwnPropertyNames(from);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      defineProperty(to, name, getOwnPropertyDescriptor(from, name));
    }
    return to;
  };

  function mixinStatics(to, from) {
    var names = getOwnPropertyNames(from);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      switch (name) {
        case 'arguments':
        case 'caller':
        case 'length':
        case 'name':
        case 'prototype':
        case 'toString':
          continue;
      }
      defineProperty(to, name, getOwnPropertyDescriptor(from, name));
    }
    return to;
  };

  function oneOf(object, propertyNames) {
    for (var i = 0; i < propertyNames.length; i++) {
      if (propertyNames[i] in object)
        return propertyNames[i];
    }
  }

  var nonEnumerableDataDescriptor = {
    value: undefined,
    configurable: true,
    enumerable: false,
    writable: true
  };

  function defineNonEnumerableDataProperty(object, name, value) {
    nonEnumerableDataDescriptor.value = value;
    defineProperty(object, name, nonEnumerableDataDescriptor);
  }

  // Mozilla's old DOM bindings are bretty busted:
  // https://bugzilla.mozilla.org/show_bug.cgi?id=855844
  // Make sure they are create before we start modifying things.
  getOwnPropertyNames(window);

  function getWrapperConstructor(node) {
    var nativePrototype = node.__proto__ || Object.getPrototypeOf(node);
    var wrapperConstructor = constructorTable.get(nativePrototype);
    if (wrapperConstructor)
      return wrapperConstructor;

    var parentWrapperConstructor = getWrapperConstructor(nativePrototype);

    var GeneratedWrapper = createWrapperConstructor(parentWrapperConstructor);
    registerInternal(nativePrototype, GeneratedWrapper, node);

    return GeneratedWrapper;
  }

  function addForwardingProperties(nativePrototype, wrapperPrototype) {
    installProperty(nativePrototype, wrapperPrototype, true);
  }

  function registerInstanceProperties(wrapperPrototype, instanceObject) {
    installProperty(instanceObject, wrapperPrototype, false);
  }

  var isFirefox = /Firefox/.test(navigator.userAgent);

  // This is used as a fallback when getting the descriptor fails in
  // installProperty.
  var dummyDescriptor = {
    get: function() {},
    set: function(v) {},
    configurable: true,
    enumerable: true
  };

  function isEventHandlerName(name) {
    return /^on[a-z]+$/.test(name);
  }

  function isIdentifierName(name) {
    return /^\w[a-zA-Z_0-9]*$/.test(name);
  }

  function getGetter(name) {
    return hasEval && isIdentifierName(name) ?
        new Function('return this.impl.' + name) :
        function() { return this.impl[name]; };
  }

  function getSetter(name) {
    return hasEval && isIdentifierName(name) ?
        new Function('v', 'this.impl.' + name + ' = v') :
        function(v) { this.impl[name] = v; };
  }

  function getMethod(name) {
    return hasEval && isIdentifierName(name) ?
        new Function('return this.impl.' + name +
                     '.apply(this.impl, arguments)') :
        function() { return this.impl[name].apply(this.impl, arguments); };
  }

  function getDescriptor(source, name) {
    try {
      return Object.getOwnPropertyDescriptor(source, name);
    } catch (ex) {
      // JSC and V8 both use data properties instead of accessors which can
      // cause getting the property desciptor to throw an exception.
      // https://bugs.webkit.org/show_bug.cgi?id=49739
      return dummyDescriptor;
    }
  }

  function installProperty(source, target, allowMethod, opt_blacklist) {
    var names = getOwnPropertyNames(source);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (name === 'polymerBlackList_')
        continue;

      if (name in target)
        continue;

      if (source.polymerBlackList_ && source.polymerBlackList_[name])
        continue;

      if (isFirefox) {
        // Tickle Firefox's old bindings.
        source.__lookupGetter__(name);
      }
      var descriptor = getDescriptor(source, name);
      var getter, setter;
      if (allowMethod && typeof descriptor.value === 'function') {
        target[name] = getMethod(name);
        continue;
      }

      var isEvent = isEventHandlerName(name);
      if (isEvent)
        getter = scope.getEventHandlerGetter(name);
      else
        getter = getGetter(name);

      if (descriptor.writable || descriptor.set) {
        if (isEvent)
          setter = scope.getEventHandlerSetter(name);
        else
          setter = getSetter(name);
      }

      defineProperty(target, name, {
        get: getter,
        set: setter,
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable
      });
    }
  }

  /**
   * @param {Function} nativeConstructor
   * @param {Function} wrapperConstructor
   * @param {Object=} opt_instance If present, this is used to extract
   *     properties from an instance object.
   */
  function register(nativeConstructor, wrapperConstructor, opt_instance) {
    var nativePrototype = nativeConstructor.prototype;
    registerInternal(nativePrototype, wrapperConstructor, opt_instance);
    mixinStatics(wrapperConstructor, nativeConstructor);
  }

  function registerInternal(nativePrototype, wrapperConstructor, opt_instance) {
    var wrapperPrototype = wrapperConstructor.prototype;
    assert(constructorTable.get(nativePrototype) === undefined);

    constructorTable.set(nativePrototype, wrapperConstructor);
    nativePrototypeTable.set(wrapperPrototype, nativePrototype);

    addForwardingProperties(nativePrototype, wrapperPrototype);
    if (opt_instance)
      registerInstanceProperties(wrapperPrototype, opt_instance);

    defineNonEnumerableDataProperty(
        wrapperPrototype, 'constructor', wrapperConstructor);
    // Set it again. Some VMs optimizes objects that are used as prototypes.
    wrapperConstructor.prototype = wrapperPrototype;
  }

  function isWrapperFor(wrapperConstructor, nativeConstructor) {
    return constructorTable.get(nativeConstructor.prototype) ===
        wrapperConstructor;
  }

  /**
   * Creates a generic wrapper constructor based on |object| and its
   * constructor.
   * @param {Node} object
   * @return {Function} The generated constructor.
   */
  function registerObject(object) {
    var nativePrototype = Object.getPrototypeOf(object);

    var superWrapperConstructor = getWrapperConstructor(nativePrototype);
    var GeneratedWrapper = createWrapperConstructor(superWrapperConstructor);
    registerInternal(nativePrototype, GeneratedWrapper, object);

    return GeneratedWrapper;
  }

  function createWrapperConstructor(superWrapperConstructor) {
    function GeneratedWrapper(node) {
      superWrapperConstructor.call(this, node);
    }
    var p = Object.create(superWrapperConstructor.prototype);
    p.constructor = GeneratedWrapper;
    GeneratedWrapper.prototype = p;

    return GeneratedWrapper;
  }

  var OriginalDOMImplementation = window.DOMImplementation;
  var OriginalEventTarget = window.EventTarget;
  var OriginalEvent = window.Event;
  var OriginalNode = window.Node;
  var OriginalWindow = window.Window;
  var OriginalRange = window.Range;
  var OriginalCanvasRenderingContext2D = window.CanvasRenderingContext2D;
  var OriginalWebGLRenderingContext = window.WebGLRenderingContext;
  var OriginalSVGElementInstance = window.SVGElementInstance;

  function isWrapper(object) {
    return object instanceof wrappers.EventTarget ||
           object instanceof wrappers.Event ||
           object instanceof wrappers.Range ||
           object instanceof wrappers.DOMImplementation ||
           object instanceof wrappers.CanvasRenderingContext2D ||
           wrappers.WebGLRenderingContext &&
               object instanceof wrappers.WebGLRenderingContext;
  }

  function isNative(object) {
    return OriginalEventTarget && object instanceof OriginalEventTarget ||
           object instanceof OriginalNode ||
           object instanceof OriginalEvent ||
           object instanceof OriginalWindow ||
           object instanceof OriginalRange ||
           object instanceof OriginalDOMImplementation ||
           object instanceof OriginalCanvasRenderingContext2D ||
           OriginalWebGLRenderingContext &&
               object instanceof OriginalWebGLRenderingContext ||
           OriginalSVGElementInstance &&
               object instanceof OriginalSVGElementInstance;
  }

  /**
   * Wraps a node in a WrapperNode. If there already exists a wrapper for the
   * |node| that wrapper is returned instead.
   * @param {Node} node
   * @return {WrapperNode}
   */
  function wrap(impl) {
    if (impl === null)
      return null;

    assert(isNative(impl));
    return impl.polymerWrapper_ ||
        (impl.polymerWrapper_ = new (getWrapperConstructor(impl))(impl));
  }

  /**
   * Unwraps a wrapper and returns the node it is wrapping.
   * @param {WrapperNode} wrapper
   * @return {Node}
   */
  function unwrap(wrapper) {
    if (wrapper === null)
      return null;
    assert(isWrapper(wrapper));
    return wrapper.impl;
  }

  /**
   * Unwraps object if it is a wrapper.
   * @param {Object} object
   * @return {Object} The native implementation object.
   */
  function unwrapIfNeeded(object) {
    return object && isWrapper(object) ? unwrap(object) : object;
  }

  /**
   * Wraps object if it is not a wrapper.
   * @param {Object} object
   * @return {Object} The wrapper for object.
   */
  function wrapIfNeeded(object) {
    return object && !isWrapper(object) ? wrap(object) : object;
  }

  /**
   * Overrides the current wrapper (if any) for node.
   * @param {Node} node
   * @param {WrapperNode=} wrapper If left out the wrapper will be created as
   *     needed next time someone wraps the node.
   */
  function rewrap(node, wrapper) {
    if (wrapper === null)
      return;
    assert(isNative(node));
    assert(wrapper === undefined || isWrapper(wrapper));
    node.polymerWrapper_ = wrapper;
  }

  var getterDescriptor = {
    get: undefined,
    configurable: true,
    enumerable: true
  };

  function defineGetter(constructor, name, getter) {
    getterDescriptor.get = getter;
    defineProperty(constructor.prototype, name, getterDescriptor);
  }

  function defineWrapGetter(constructor, name) {
    defineGetter(constructor, name, function() {
      return wrap(this.impl[name]);
    });
  }

  /**
   * Forwards existing methods on the native object to the wrapper methods.
   * This does not wrap any of the arguments or the return value since the
   * wrapper implementation already takes care of that.
   * @param {Array.<Function>} constructors
   * @parem {Array.<string>} names
   */
  function forwardMethodsToWrapper(constructors, names) {
    constructors.forEach(function(constructor) {
      names.forEach(function(name) {
        constructor.prototype[name] = function() {
          var w = wrapIfNeeded(this);
          return w[name].apply(w, arguments);
        };
      });
    });
  }

  scope.assert = assert;
  scope.constructorTable = constructorTable;
  scope.defineGetter = defineGetter;
  scope.defineWrapGetter = defineWrapGetter;
  scope.forwardMethodsToWrapper = forwardMethodsToWrapper;
  scope.isWrapper = isWrapper;
  scope.isWrapperFor = isWrapperFor;
  scope.mixin = mixin;
  scope.nativePrototypeTable = nativePrototypeTable;
  scope.oneOf = oneOf;
  scope.registerObject = registerObject;
  scope.registerWrapper = register;
  scope.rewrap = rewrap;
  scope.unwrap = unwrap;
  scope.unwrapIfNeeded = unwrapIfNeeded;
  scope.wrap = wrap;
  scope.wrapIfNeeded = wrapIfNeeded;
  scope.wrappers = wrappers;

})(window.ShadowDOMPolyfill);

/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is goverened by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(context) {
  'use strict';

  var OriginalMutationObserver = window.MutationObserver;
  var callbacks = [];
  var pending = false;
  var timerFunc;

  function handle() {
    pending = false;
    var copies = callbacks.slice(0);
    callbacks = [];
    for (var i = 0; i < copies.length; i++) {
      (0, copies[i])();
    }
  }

  if (OriginalMutationObserver) {
    var counter = 1;
    var observer = new OriginalMutationObserver(handle);
    var textNode = document.createTextNode(counter);
    observer.observe(textNode, {characterData: true});

    timerFunc = function() {
      counter = (counter + 1) % 2;
      textNode.data = counter;
    };

  } else {
    timerFunc = window.setImmediate || window.setTimeout;
  }

  function setEndOfMicrotask(func) {
    callbacks.push(func);
    if (pending)
      return;
    pending = true;
    timerFunc(handle, 0);
  }

  context.setEndOfMicrotask = setEndOfMicrotask;

})(window.ShadowDOMPolyfill);

/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is goverened by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(scope) {
  'use strict';

  var setEndOfMicrotask = scope.setEndOfMicrotask
  var wrapIfNeeded = scope.wrapIfNeeded
  var wrappers = scope.wrappers;

  var registrationsTable = new WeakMap();
  var globalMutationObservers = [];
  var isScheduled = false;

  function scheduleCallback(observer) {
    if (isScheduled)
      return;
    setEndOfMicrotask(notifyObservers);
    isScheduled = true;
  }

  // http://dom.spec.whatwg.org/#mutation-observers
  function notifyObservers() {
    isScheduled = false;

    do {
      var notifyList = globalMutationObservers.slice();
      var anyNonEmpty = false;
      for (var i = 0; i < notifyList.length; i++) {
        var mo = notifyList[i];
        var queue = mo.takeRecords();
        removeTransientObserversFor(mo);
        if (queue.length) {
          mo.callback_(queue, mo);
          anyNonEmpty = true;
        }
      }
    } while (anyNonEmpty);
  }

  /**
   * @param {string} type
   * @param {Node} target
   * @constructor
   */
  function MutationRecord(type, target) {
    this.type = type;
    this.target = target;
    this.addedNodes = new wrappers.NodeList();
    this.removedNodes = new wrappers.NodeList();
    this.previousSibling = null;
    this.nextSibling = null;
    this.attributeName = null;
    this.attributeNamespace = null;
    this.oldValue = null;
  }

  /**
   * Registers transient observers to ancestor and its ancesors for the node
   * which was removed.
   * @param {!Node} ancestor
   * @param {!Node} node
   */
  function registerTransientObservers(ancestor, node) {
    for (; ancestor; ancestor = ancestor.parentNode) {
      var registrations = registrationsTable.get(ancestor);
      if (!registrations)
        continue;
      for (var i = 0; i < registrations.length; i++) {
        var registration = registrations[i];
        if (registration.options.subtree)
          registration.addTransientObserver(node);
      }
    }
  }

  function removeTransientObserversFor(observer) {
    for (var i = 0; i < observer.nodes_.length; i++) {
      var node = observer.nodes_[i];
      var registrations = registrationsTable.get(node);
      if (!registrations)
        return;
      for (var j = 0; j < registrations.length; j++) {
        var registration = registrations[j];
        if (registration.observer === observer)
          registration.removeTransientObservers();
      }
    }
  }

  // http://dom.spec.whatwg.org/#queue-a-mutation-record
  function enqueueMutation(target, type, data) {
    // 1.
    var interestedObservers = Object.create(null);
    var associatedStrings = Object.create(null);

    // 2.
    for (var node = target; node; node = node.parentNode) {
      // 3.
      var registrations = registrationsTable.get(node);
      if (!registrations)
        continue;
      for (var j = 0; j < registrations.length; j++) {
        var registration = registrations[j];
        var options = registration.options;
        // 1.
        if (node !== target && !options.subtree)
          continue;

        // 2.
        if (type === 'attributes' && !options.attributes)
          continue;

        // 3. If type is "attributes", options's attributeFilter is present, and
        // either options's attributeFilter does not contain name or namespace
        // is non-null, continue.
        if (type === 'attributes' && options.attributeFilter &&
            (data.namespace !== null ||
             options.attributeFilter.indexOf(data.name) === -1)) {
          continue;
        }

        // 4.
        if (type === 'characterData' && !options.characterData)
          continue;

        // 5.
        if (type === 'childList' && !options.childList)
          continue;

        // 6.
        var observer = registration.observer;
        interestedObservers[observer.uid_] = observer;

        // 7. If either type is "attributes" and options's attributeOldValue is
        // true, or type is "characterData" and options's characterDataOldValue
        // is true, set the paired string of registered observer's observer in
        // interested observers to oldValue.
        if (type === 'attributes' && options.attributeOldValue ||
            type === 'characterData' && options.characterDataOldValue) {
          associatedStrings[observer.uid_] = data.oldValue;
        }
      }
    }

    var anyRecordsEnqueued = false;

    // 4.
    for (var uid in interestedObservers) {
      var observer = interestedObservers[uid];
      var record = new MutationRecord(type, target);

      // 2.
      if ('name' in data && 'namespace' in data) {
        record.attributeName = data.name;
        record.attributeNamespace = data.namespace;
      }

      // 3.
      if (data.addedNodes)
        record.addedNodes = data.addedNodes;

      // 4.
      if (data.removedNodes)
        record.removedNodes = data.removedNodes;

      // 5.
      if (data.previousSibling)
        record.previousSibling = data.previousSibling;

      // 6.
      if (data.nextSibling)
        record.nextSibling = data.nextSibling;

      // 7.
      if (associatedStrings[uid] !== undefined)
        record.oldValue = associatedStrings[uid];

      // 8.
      observer.records_.push(record);

      anyRecordsEnqueued = true;
    }

    if (anyRecordsEnqueued)
      scheduleCallback();
  }

  var slice = Array.prototype.slice;

  /**
   * @param {!Object} options
   * @constructor
   */
  function MutationObserverOptions(options) {
    this.childList = !!options.childList;
    this.subtree = !!options.subtree;

    // 1. If either options' attributeOldValue or attributeFilter is present
    // and options' attributes is omitted, set options' attributes to true.
    if (!('attributes' in options) &&
        ('attributeOldValue' in options || 'attributeFilter' in options)) {
      this.attributes = true;
    } else {
      this.attributes = !!options.attributes;
    }

    // 2. If options' characterDataOldValue is present and options'
    // characterData is omitted, set options' characterData to true.
    if ('characterDataOldValue' in options && !('characterData' in options))
      this.characterData = true;
    else
      this.characterData = !!options.characterData;

    // 3. & 4.
    if (!this.attributes &&
        (options.attributeOldValue || 'attributeFilter' in options) ||
        // 5.
        !this.characterData && options.characterDataOldValue) {
      throw new TypeError();
    }

    this.characterData = !!options.characterData;
    this.attributeOldValue = !!options.attributeOldValue;
    this.characterDataOldValue = !!options.characterDataOldValue;
    if ('attributeFilter' in options) {
      if (options.attributeFilter == null ||
          typeof options.attributeFilter !== 'object') {
        throw new TypeError();
      }
      this.attributeFilter = slice.call(options.attributeFilter);
    } else {
      this.attributeFilter = null;
    }
  }

  var uidCounter = 0;

  /**
   * The class that maps to the DOM MutationObserver interface.
   * @param {Function} callback.
   * @constructor
   */
  function MutationObserver(callback) {
    this.callback_ = callback;
    this.nodes_ = [];
    this.records_ = [];
    this.uid_ = ++uidCounter;

    // This will leak. There is no way to implement this without WeakRefs :'(
    globalMutationObservers.push(this);
  }

  MutationObserver.prototype = {
    // http://dom.spec.whatwg.org/#dom-mutationobserver-observe
    observe: function(target, options) {
      target = wrapIfNeeded(target);

      var newOptions = new MutationObserverOptions(options);

      // 6.
      var registration;
      var registrations = registrationsTable.get(target);
      if (!registrations)
        registrationsTable.set(target, registrations = []);

      for (var i = 0; i < registrations.length; i++) {
        if (registrations[i].observer === this) {
          registration = registrations[i];
          // 6.1.
          registration.removeTransientObservers();
          // 6.2.
          registration.options = newOptions;
        }
      }

      // 7.
      if (!registration) {
        registration = new Registration(this, target, newOptions);
        registrations.push(registration);
        this.nodes_.push(target);
      }
    },

    // http://dom.spec.whatwg.org/#dom-mutationobserver-disconnect
    disconnect: function() {
      this.nodes_.forEach(function(node) {
        var registrations = registrationsTable.get(node);
        for (var i = 0; i < registrations.length; i++) {
          var registration = registrations[i];
          if (registration.observer === this) {
            registrations.splice(i, 1);
            // Each node can only have one registered observer associated with
            // this observer.
            break;
          }
        }
      }, this);
      this.records_ = [];
    },

    takeRecords: function() {
      var copyOfRecords = this.records_;
      this.records_ = [];
      return copyOfRecords;
    }
  };

  /**
   * Class used to represent a registered observer.
   * @param {MutationObserver} observer
   * @param {Node} target
   * @param {MutationObserverOptions} options
   * @constructor
   */
  function Registration(observer, target, options) {
    this.observer = observer;
    this.target = target;
    this.options = options;
    this.transientObservedNodes = [];
  }

  Registration.prototype = {
    /**
     * Adds a transient observer on node. The transient observer gets removed
     * next time we deliver the change records.
     * @param {Node} node
     */
    addTransientObserver: function(node) {
      // Don't add transient observers on the target itself. We already have all
      // the required listeners set up on the target.
      if (node === this.target)
        return;

      this.transientObservedNodes.push(node);
      var registrations = registrationsTable.get(node);
      if (!registrations)
        registrationsTable.set(node, registrations = []);

      // We know that registrations does not contain this because we already
      // checked if node === this.target.
      registrations.push(this);
    },

    removeTransientObservers: function() {
      var transientObservedNodes = this.transientObservedNodes;
      this.transientObservedNodes = [];

      for (var i = 0; i < transientObservedNodes.length; i++) {
        var node = transientObservedNodes[i];
        var registrations = registrationsTable.get(node);
        for (var j = 0; j < registrations.length; j++) {
          if (registrations[j] === this) {
            registrations.splice(j, 1);
            // Each node can only have one registered observer associated with
            // this observer.
            break;
          }
        }
      }
    }
  };

  scope.enqueueMutation = enqueueMutation;
  scope.registerTransientObservers = registerTransientObservers;
  scope.wrappers.MutationObserver = MutationObserver;
  scope.wrappers.MutationRecord = MutationRecord;

})(window.ShadowDOMPolyfill);

/**
 * Copyright 2014 The Polymer Authors. All rights reserved.
 * Use of this source code is goverened by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(scope) {
  'use strict';

  /**
   * A tree scope represents the root of a tree. All nodes in a tree point to
   * the same TreeScope object. The tree scope of a node get set the first time
   * it is accessed or when a node is added or remove to a tree.
   * @constructor
   */
  function TreeScope(root, parent) {
    this.root = root;
    this.parent = parent;
  }

  TreeScope.prototype = {
    get renderer() {
      if (this.root instanceof scope.wrappers.ShadowRoot) {
        return scope.getRendererForHost(this.root.host);
      }
      return null;
    },

    contains: function(treeScope) {
      for (; treeScope; treeScope = treeScope.parent) {
        if (treeScope === this)
          return true;
      }
      return false;
    }
  };

  function setTreeScope(node, treeScope) {
    if (node.treeScope_ !== treeScope) {
      node.treeScope_ = treeScope;
      for (var sr = node.shadowRoot; sr; sr = sr.olderShadowRoot) {
        sr.treeScope_.parent = treeScope;
      }
      for (var child = node.firstChild; child; child = child.nextSibling) {
        setTreeScope(child, treeScope);
      }
    }
  }

  function getTreeScope(node) {
    if (node.treeScope_)
      return node.treeScope_;
    var parent = node.parentNode;
    var treeScope;
    if (parent)
      treeScope = getTreeScope(parent);
    else
      treeScope = new TreeScope(node, null);
    return node.treeScope_ = treeScope;
  }

  scope.TreeScope = TreeScope;
  scope.getTreeScope = getTreeScope;
  scope.setTreeScope = setTreeScope;

})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var forwardMethodsToWrapper = scope.forwardMethodsToWrapper;
  var getTreeScope = scope.getTreeScope;
  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;
  var unwrap = scope.unwrap;
  var wrap = scope.wrap;
  var wrappers = scope.wrappers;

  var wrappedFuns = new WeakMap();
  var listenersTable = new WeakMap();
  var handledEventsTable = new WeakMap();
  var currentlyDispatchingEvents = new WeakMap();
  var targetTable = new WeakMap();
  var currentTargetTable = new WeakMap();
  var relatedTargetTable = new WeakMap();
  var eventPhaseTable = new WeakMap();
  var stopPropagationTable = new WeakMap();
  var stopImmediatePropagationTable = new WeakMap();
  var eventHandlersTable = new WeakMap();
  var eventPathTable = new WeakMap();

  function isShadowRoot(node) {
    return node instanceof wrappers.ShadowRoot;
  }

  function isInsertionPoint(node) {
    var localName = node.localName;
    return localName === 'content' || localName === 'shadow';
  }

  function isShadowHost(node) {
    return !!node.shadowRoot;
  }

  function getEventParent(node) {
    var dv;
    return node.parentNode || (dv = node.defaultView) && wrap(dv) || null;
  }

  // https://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/shadow/index.html#dfn-adjusted-parent
  function calculateParents(node, context, ancestors) {
    if (ancestors.length)
      return ancestors.shift();

    // 1.
    if (isShadowRoot(node))
      return getInsertionParent(node) || node.host;

    // 2.
    var eventParents = scope.eventParentsTable.get(node);
    if (eventParents) {
      // Copy over the remaining event parents for next iteration.
      for (var i = 1; i < eventParents.length; i++) {
        ancestors[i - 1] = eventParents[i];
      }
      return eventParents[0];
    }

    // 3.
    if (context && isInsertionPoint(node)) {
      var parentNode = node.parentNode;
      if (parentNode && isShadowHost(parentNode)) {
        var trees = scope.getShadowTrees(parentNode);
        var p = getInsertionParent(context);
        for (var i = 0; i < trees.length; i++) {
          if (trees[i].contains(p))
            return p;
        }
      }
    }

    return getEventParent(node);
  }

  // https://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/shadow/index.html#event-retargeting
  function retarget(node) {
    var stack = [];  // 1.
    var ancestor = node;  // 2.
    var targets = [];
    var ancestors = [];
    while (ancestor) {  // 3.
      var context = null;  // 3.2.
      // TODO(arv): Change order of these. If the stack is empty we always end
      // up pushing ancestor, no matter what.
      if (isInsertionPoint(ancestor)) {  // 3.1.
        context = topMostNotInsertionPoint(stack);  // 3.1.1.
        var top = stack[stack.length - 1] || ancestor;  // 3.1.2.
        stack.push(top);
      } else if (!stack.length) {
        stack.push(ancestor);  // 3.3.
      }
      var target = stack[stack.length - 1];  // 3.4.
      targets.push({target: target, currentTarget: ancestor});  // 3.5.
      if (isShadowRoot(ancestor))  // 3.6.
        stack.pop();  // 3.6.1.

      ancestor = calculateParents(ancestor, context, ancestors);  // 3.7.
    }
    return targets;
  }

  function topMostNotInsertionPoint(stack) {
    for (var i = stack.length - 1; i >= 0; i--) {
      if (!isInsertionPoint(stack[i]))
        return stack[i];
    }
    return null;
  }

  // https://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/shadow/index.html#dfn-adjusted-related-target
  function adjustRelatedTarget(target, related) {
    var ancestors = [];
    while (target) {  // 3.
      var stack = [];  // 3.1.
      var ancestor = related;  // 3.2.
      var last = undefined;  // 3.3. Needs to be reset every iteration.
      while (ancestor) {
        var context = null;
        if (!stack.length) {
          stack.push(ancestor);
        } else {
          if (isInsertionPoint(ancestor)) {  // 3.4.3.
            context = topMostNotInsertionPoint(stack);
            // isDistributed is more general than checking whether last is
            // assigned into ancestor.
            if (isDistributed(last)) {  // 3.4.3.2.
              var head = stack[stack.length - 1];
              stack.push(head);
            }
          }
        }

        if (inSameTree(ancestor, target))  // 3.4.4.
          return stack[stack.length - 1];

        if (isShadowRoot(ancestor))  // 3.4.5.
          stack.pop();

        last = ancestor;  // 3.4.6.
        ancestor = calculateParents(ancestor, context, ancestors);  // 3.4.7.
      }
      if (isShadowRoot(target))  // 3.5.
        target = target.host;
      else
        target = target.parentNode;  // 3.6.
    }
  }

  function getInsertionParent(node) {
    return scope.insertionParentTable.get(node);
  }

  function isDistributed(node) {
    return getInsertionParent(node);
  }

  function inSameTree(a, b) {
    return getTreeScope(a) === getTreeScope(b);
  }

  // pendingError is used to rethrow the first error we got during an event
  // dispatch. The browser actually reports all errors but to do that we would
  // need to rethrow the error asynchronously.
  var pendingError;

  function dispatchOriginalEvent(originalEvent) {
    // Make sure this event is only dispatched once.
    if (handledEventsTable.get(originalEvent))
      return;
    handledEventsTable.set(originalEvent, true);
    dispatchEvent(wrap(originalEvent), wrap(originalEvent.target));
    if (pendingError) {
      var err = pendingError;
      pendingError = null;
      throw err;
    }
  }

  function isLoadLikeEvent(event) {
    switch (event.type) {
      case 'beforeunload':
      case 'load':
      case 'unload':
        return true;
    }
    return false;
  }

  function dispatchEvent(event, originalWrapperTarget) {
    if (currentlyDispatchingEvents.get(event))
      throw new Error('InvalidStateError')
    currentlyDispatchingEvents.set(event, true);

    // Render to ensure that the event path is correct.
    scope.renderAllPending();
    var eventPath = retarget(originalWrapperTarget);

    // For window "load" events the "load" event is dispatched at the window but
    // the target is set to the document.
    //
    // http://www.whatwg.org/specs/web-apps/current-work/multipage/the-end.html#the-end
    //
    // TODO(arv): Find a less hacky way to do this.
    if (eventPath.length === 2 &&
        eventPath[0].target instanceof wrappers.Document &&
        isLoadLikeEvent(event)) {
      eventPath.shift();
    }

    eventPathTable.set(event, eventPath);

    if (dispatchCapturing(event, eventPath)) {
      if (dispatchAtTarget(event, eventPath)) {
        dispatchBubbling(event, eventPath);
      }
    }

    eventPhaseTable.set(event, Event.NONE);
    currentTargetTable.delete(event, null);
    currentlyDispatchingEvents.delete(event);

    return event.defaultPrevented;
  }

  function dispatchCapturing(event, eventPath) {
    var phase;

    for (var i = eventPath.length - 1; i > 0; i--) {
      var target = eventPath[i].target;
      var currentTarget = eventPath[i].currentTarget;
      if (target === currentTarget)
        continue;

      phase = Event.CAPTURING_PHASE;
      if (!invoke(eventPath[i], event, phase))
        return false;
    }

    return true;
  }

  function dispatchAtTarget(event, eventPath) {
    var phase = Event.AT_TARGET;
    return invoke(eventPath[0], event, phase);
  }

  function dispatchBubbling(event, eventPath) {
    var bubbles = event.bubbles;
    var phase;

    for (var i = 1; i < eventPath.length; i++) {
      var target = eventPath[i].target;
      var currentTarget = eventPath[i].currentTarget;
      if (target === currentTarget)
        phase = Event.AT_TARGET;
      else if (bubbles && !stopImmediatePropagationTable.get(event))
        phase = Event.BUBBLING_PHASE;
      else
        continue;

      if (!invoke(eventPath[i], event, phase))
        return;
    }
  }

  function invoke(tuple, event, phase) {
    var target = tuple.target;
    var currentTarget = tuple.currentTarget;

    var listeners = listenersTable.get(currentTarget);
    if (!listeners)
      return true;

    if ('relatedTarget' in event) {
      var originalEvent = unwrap(event);
      var unwrappedRelatedTarget = originalEvent.relatedTarget;

      // X-Tag sets relatedTarget on a CustomEvent. If they do that there is no
      // way to have relatedTarget return the adjusted target but worse is that
      // the originalEvent might not have a relatedTarget so we hit an assert
      // when we try to wrap it.
      if (unwrappedRelatedTarget) {
        // In IE we can get objects that are not EventTargets at this point.
        // Safari does not have an EventTarget interface so revert to checking
        // for addEventListener as an approximation.
        if (unwrappedRelatedTarget instanceof Object &&
            unwrappedRelatedTarget.addEventListener) {
          var relatedTarget = wrap(unwrappedRelatedTarget);

          var adjusted = adjustRelatedTarget(currentTarget, relatedTarget);
          if (adjusted === target)
            return true;
        } else {
          adjusted = null;
        }
        relatedTargetTable.set(event, adjusted);
      }
    }

    eventPhaseTable.set(event, phase);
    var type = event.type;

    var anyRemoved = false;
    targetTable.set(event, target);
    currentTargetTable.set(event, currentTarget);

    for (var i = 0; i < listeners.length; i++) {
      var listener = listeners[i];
      if (listener.removed) {
        anyRemoved = true;
        continue;
      }

      if (listener.type !== type ||
          !listener.capture && phase === Event.CAPTURING_PHASE ||
          listener.capture && phase === Event.BUBBLING_PHASE) {
        continue;
      }

      try {
        if (typeof listener.handler === 'function')
          listener.handler.call(currentTarget, event);
        else
          listener.handler.handleEvent(event);

        if (stopImmediatePropagationTable.get(event))
          return false;

      } catch (ex) {
        if (!pendingError)
          pendingError = ex;
      }
    }

    if (anyRemoved) {
      var copy = listeners.slice();
      listeners.length = 0;
      for (var i = 0; i < copy.length; i++) {
        if (!copy[i].removed)
          listeners.push(copy[i]);
      }
    }

    return !stopPropagationTable.get(event);
  }

  function Listener(type, handler, capture) {
    this.type = type;
    this.handler = handler;
    this.capture = Boolean(capture);
  }
  Listener.prototype = {
    equals: function(that) {
      return this.handler === that.handler && this.type === that.type &&
          this.capture === that.capture;
    },
    get removed() {
      return this.handler === null;
    },
    remove: function() {
      this.handler = null;
    }
  };

  var OriginalEvent = window.Event;
  OriginalEvent.prototype.polymerBlackList_ = {
    returnValue: true,
    // TODO(arv): keyLocation is part of KeyboardEvent but Firefox does not
    // support constructable KeyboardEvent so we keep it here for now.
    keyLocation: true
  };

  /**
   * Creates a new Event wrapper or wraps an existin native Event object.
   * @param {string|Event} type
   * @param {Object=} options
   * @constructor
   */
  function Event(type, options) {
    if (type instanceof OriginalEvent) {
      var impl = type;
      if (!OriginalBeforeUnloadEvent && impl.type === 'beforeunload')
        return new BeforeUnloadEvent(impl);
      this.impl = impl;
    } else {
      return wrap(constructEvent(OriginalEvent, 'Event', type, options));
    }
  }
  Event.prototype = {
    get target() {
      return targetTable.get(this);
    },
    get currentTarget() {
      return currentTargetTable.get(this);
    },
    get eventPhase() {
      return eventPhaseTable.get(this);
    },
    get path() {
      var nodeList = new wrappers.NodeList();
      var eventPath = eventPathTable.get(this);
      if (eventPath) {
        var index = 0;
        var lastIndex = eventPath.length - 1;
        var baseRoot = getTreeScope(currentTargetTable.get(this));

        for (var i = 0; i <= lastIndex; i++) {
          var currentTarget = eventPath[i].currentTarget;
          var currentRoot = getTreeScope(currentTarget);
          if (currentRoot.contains(baseRoot) &&
              // Make sure we do not add Window to the path.
              (i !== lastIndex || currentTarget instanceof wrappers.Node)) {
            nodeList[index++] = currentTarget;
          }
        }
        nodeList.length = index;
      }
      return nodeList;
    },
    stopPropagation: function() {
      stopPropagationTable.set(this, true);
    },
    stopImmediatePropagation: function() {
      stopPropagationTable.set(this, true);
      stopImmediatePropagationTable.set(this, true);
    }
  };
  registerWrapper(OriginalEvent, Event, document.createEvent('Event'));

  function unwrapOptions(options) {
    if (!options || !options.relatedTarget)
      return options;
    return Object.create(options, {
      relatedTarget: {value: unwrap(options.relatedTarget)}
    });
  }

  function registerGenericEvent(name, SuperEvent, prototype) {
    var OriginalEvent = window[name];
    var GenericEvent = function(type, options) {
      if (type instanceof OriginalEvent)
        this.impl = type;
      else
        return wrap(constructEvent(OriginalEvent, name, type, options));
    };
    GenericEvent.prototype = Object.create(SuperEvent.prototype);
    if (prototype)
      mixin(GenericEvent.prototype, prototype);
    if (OriginalEvent) {
      // - Old versions of Safari fails on new FocusEvent (and others?).
      // - IE does not support event constructors.
      // - createEvent('FocusEvent') throws in Firefox.
      // => Try the best practice solution first and fallback to the old way
      // if needed.
      try {
        registerWrapper(OriginalEvent, GenericEvent, new OriginalEvent('temp'));
      } catch (ex) {
        registerWrapper(OriginalEvent, GenericEvent,
                        document.createEvent(name));
      }
    }
    return GenericEvent;
  }

  var UIEvent = registerGenericEvent('UIEvent', Event);
  var CustomEvent = registerGenericEvent('CustomEvent', Event);

  var relatedTargetProto = {
    get relatedTarget() {
      var relatedTarget = relatedTargetTable.get(this);
      // relatedTarget can be null.
      if (relatedTarget !== undefined)
        return relatedTarget;
      return wrap(unwrap(this).relatedTarget);
    }
  };

  function getInitFunction(name, relatedTargetIndex) {
    return function() {
      arguments[relatedTargetIndex] = unwrap(arguments[relatedTargetIndex]);
      var impl = unwrap(this);
      impl[name].apply(impl, arguments);
    };
  }

  var mouseEventProto = mixin({
    initMouseEvent: getInitFunction('initMouseEvent', 14)
  }, relatedTargetProto);

  var focusEventProto = mixin({
    initFocusEvent: getInitFunction('initFocusEvent', 5)
  }, relatedTargetProto);

  var MouseEvent = registerGenericEvent('MouseEvent', UIEvent, mouseEventProto);
  var FocusEvent = registerGenericEvent('FocusEvent', UIEvent, focusEventProto);

  // In case the browser does not support event constructors we polyfill that
  // by calling `createEvent('Foo')` and `initFooEvent` where the arguments to
  // `initFooEvent` are derived from the registered default event init dict.
  var defaultInitDicts = Object.create(null);

  var supportsEventConstructors = (function() {
    try {
      new window.FocusEvent('focus');
    } catch (ex) {
      return false;
    }
    return true;
  })();

  /**
   * Constructs a new native event.
   */
  function constructEvent(OriginalEvent, name, type, options) {
    if (supportsEventConstructors)
      return new OriginalEvent(type, unwrapOptions(options));

    // Create the arguments from the default dictionary.
    var event = unwrap(document.createEvent(name));
    var defaultDict = defaultInitDicts[name];
    var args = [type];
    Object.keys(defaultDict).forEach(function(key) {
      var v = options != null && key in options ?
          options[key] : defaultDict[key];
      if (key === 'relatedTarget')
        v = unwrap(v);
      args.push(v);
    });
    event['init' + name].apply(event, args);
    return event;
  }

  if (!supportsEventConstructors) {
    var configureEventConstructor = function(name, initDict, superName) {
      if (superName) {
        var superDict = defaultInitDicts[superName];
        initDict = mixin(mixin({}, superDict), initDict);
      }

      defaultInitDicts[name] = initDict;
    };

    // The order of the default event init dictionary keys is important, the
    // arguments to initFooEvent is derived from that.
    configureEventConstructor('Event', {bubbles: false, cancelable: false});
    configureEventConstructor('CustomEvent', {detail: null}, 'Event');
    configureEventConstructor('UIEvent', {view: null, detail: 0}, 'Event');
    configureEventConstructor('MouseEvent', {
      screenX: 0,
      screenY: 0,
      clientX: 0,
      clientY: 0,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      button: 0,
      relatedTarget: null
    }, 'UIEvent');
    configureEventConstructor('FocusEvent', {relatedTarget: null}, 'UIEvent');
  }

  // Safari 7 does not yet have BeforeUnloadEvent.
  // https://bugs.webkit.org/show_bug.cgi?id=120849
  var OriginalBeforeUnloadEvent = window.BeforeUnloadEvent;

  function BeforeUnloadEvent(impl) {
    Event.call(this, impl);
  }
  BeforeUnloadEvent.prototype = Object.create(Event.prototype);
  mixin(BeforeUnloadEvent.prototype, {
    get returnValue() {
      return this.impl.returnValue;
    },
    set returnValue(v) {
      this.impl.returnValue = v;
    }
  });

  if (OriginalBeforeUnloadEvent)
    registerWrapper(OriginalBeforeUnloadEvent, BeforeUnloadEvent);

  function isValidListener(fun) {
    if (typeof fun === 'function')
      return true;
    return fun && fun.handleEvent;
  }

  function isMutationEvent(type) {
    switch (type) {
      case 'DOMAttrModified':
      case 'DOMAttributeNameChanged':
      case 'DOMCharacterDataModified':
      case 'DOMElementNameChanged':
      case 'DOMNodeInserted':
      case 'DOMNodeInsertedIntoDocument':
      case 'DOMNodeRemoved':
      case 'DOMNodeRemovedFromDocument':
      case 'DOMSubtreeModified':
        return true;
    }
    return false;
  }

  var OriginalEventTarget = window.EventTarget;

  /**
   * This represents a wrapper for an EventTarget.
   * @param {!EventTarget} impl The original event target.
   * @constructor
   */
  function EventTarget(impl) {
    this.impl = impl;
  }

  // Node and Window have different internal type checks in WebKit so we cannot
  // use the same method as the original function.
  var methodNames = [
    'addEventListener',
    'removeEventListener',
    'dispatchEvent'
  ];

  [Node, Window].forEach(function(constructor) {
    var p = constructor.prototype;
    methodNames.forEach(function(name) {
      Object.defineProperty(p, name + '_', {value: p[name]});
    });
  });

  function getTargetToListenAt(wrapper) {
    if (wrapper instanceof wrappers.ShadowRoot)
      wrapper = wrapper.host;
    return unwrap(wrapper);
  }

  EventTarget.prototype = {
    addEventListener: function(type, fun, capture) {
      if (!isValidListener(fun) || isMutationEvent(type))
        return;

      var listener = new Listener(type, fun, capture);
      var listeners = listenersTable.get(this);
      if (!listeners) {
        listeners = [];
        listenersTable.set(this, listeners);
      } else {
        // Might have a duplicate.
        for (var i = 0; i < listeners.length; i++) {
          if (listener.equals(listeners[i]))
            return;
        }
      }

      listeners.push(listener);

      var target = getTargetToListenAt(this);
      target.addEventListener_(type, dispatchOriginalEvent, true);
    },
    removeEventListener: function(type, fun, capture) {
      capture = Boolean(capture);
      var listeners = listenersTable.get(this);
      if (!listeners)
        return;
      var count = 0, found = false;
      for (var i = 0; i < listeners.length; i++) {
        if (listeners[i].type === type && listeners[i].capture === capture) {
          count++;
          if (listeners[i].handler === fun) {
            found = true;
            listeners[i].remove();
          }
        }
      }

      if (found && count === 1) {
        var target = getTargetToListenAt(this);
        target.removeEventListener_(type, dispatchOriginalEvent, true);
      }
    },
    dispatchEvent: function(event) {
      // We want to use the native dispatchEvent because it triggers the default
      // actions (like checking a checkbox). However, if there are no listeners
      // in the composed tree then there are no events that will trigger and
      // listeners in the non composed tree that are part of the event path are
      // not notified.
      //
      // If we find out that there are no listeners in the composed tree we add
      // a temporary listener to the target which makes us get called back even
      // in that case.

      var nativeEvent = unwrap(event);
      var eventType = nativeEvent.type;

      // Allow dispatching the same event again. This is safe because if user
      // code calls this during an existing dispatch of the same event the
      // native dispatchEvent throws (that is required by the spec).
      handledEventsTable.set(nativeEvent, false);

      // Force rendering since we prefer native dispatch and that works on the
      // composed tree.
      scope.renderAllPending();

      var tempListener;
      if (!hasListenerInAncestors(this, eventType)) {
        tempListener = function() {};
        this.addEventListener(eventType, tempListener, true);
      }

      try {
        return unwrap(this).dispatchEvent_(nativeEvent);
      } finally {
        if (tempListener)
          this.removeEventListener(eventType, tempListener, true);
      }
    }
  };

  function hasListener(node, type) {
    var listeners = listenersTable.get(node);
    if (listeners) {
      for (var i = 0; i < listeners.length; i++) {
        if (!listeners[i].removed && listeners[i].type === type)
          return true;
      }
    }
    return false;
  }

  function hasListenerInAncestors(target, type) {
    for (var node = unwrap(target); node; node = node.parentNode) {
      if (hasListener(wrap(node), type))
        return true;
    }
    return false;
  }

  if (OriginalEventTarget)
    registerWrapper(OriginalEventTarget, EventTarget);

  function wrapEventTargetMethods(constructors) {
    forwardMethodsToWrapper(constructors, methodNames);
  }

  var originalElementFromPoint = document.elementFromPoint;

  function elementFromPoint(self, document, x, y) {
    scope.renderAllPending();

    var element = wrap(originalElementFromPoint.call(document.impl, x, y));
    var targets = retarget(element, this)
    for (var i = 0; i < targets.length; i++) {
      var target = targets[i];
      if (target.currentTarget === self)
        return target.target;
    }
    return null;
  }

  /**
   * Returns a function that is to be used as a getter for `onfoo` properties.
   * @param {string} name
   * @return {Function}
   */
  function getEventHandlerGetter(name) {
    return function() {
      var inlineEventHandlers = eventHandlersTable.get(this);
      return inlineEventHandlers && inlineEventHandlers[name] &&
          inlineEventHandlers[name].value || null;
     };
  }

  /**
   * Returns a function that is to be used as a setter for `onfoo` properties.
   * @param {string} name
   * @return {Function}
   */
  function getEventHandlerSetter(name) {
    var eventType = name.slice(2);
    return function(value) {
      var inlineEventHandlers = eventHandlersTable.get(this);
      if (!inlineEventHandlers) {
        inlineEventHandlers = Object.create(null);
        eventHandlersTable.set(this, inlineEventHandlers);
      }

      var old = inlineEventHandlers[name];
      if (old)
        this.removeEventListener(eventType, old.wrapped, false);

      if (typeof value === 'function') {
        var wrapped = function(e) {
          var rv = value.call(this, e);
          if (rv === false)
            e.preventDefault();
          else if (name === 'onbeforeunload' && typeof rv === 'string')
            e.returnValue = rv;
          // mouseover uses true for preventDefault but preventDefault for
          // mouseover is ignored by browsers these day.
        };

        this.addEventListener(eventType, wrapped, false);
        inlineEventHandlers[name] = {
          value: value,
          wrapped: wrapped
        };
      }
    };
  }

  scope.adjustRelatedTarget = adjustRelatedTarget;
  scope.elementFromPoint = elementFromPoint;
  scope.getEventHandlerGetter = getEventHandlerGetter;
  scope.getEventHandlerSetter = getEventHandlerSetter;
  scope.wrapEventTargetMethods = wrapEventTargetMethods;
  scope.wrappers.BeforeUnloadEvent = BeforeUnloadEvent;
  scope.wrappers.CustomEvent = CustomEvent;
  scope.wrappers.Event = Event;
  scope.wrappers.EventTarget = EventTarget;
  scope.wrappers.FocusEvent = FocusEvent;
  scope.wrappers.MouseEvent = MouseEvent;
  scope.wrappers.UIEvent = UIEvent;

})(window.ShadowDOMPolyfill);

// Copyright 2012 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var wrap = scope.wrap;

  var nonEnumDescriptor = {enumerable: false};

  function nonEnum(obj, prop) {
    Object.defineProperty(obj, prop, nonEnumDescriptor);
  }

  function NodeList() {
    this.length = 0;
    nonEnum(this, 'length');
  }
  NodeList.prototype = {
    item: function(index) {
      return this[index];
    }
  };
  nonEnum(NodeList.prototype, 'item');

  function wrapNodeList(list) {
    if (list == null)
      return list;
    var wrapperList = new NodeList();
    for (var i = 0, length = list.length; i < length; i++) {
      wrapperList[i] = wrap(list[i]);
    }
    wrapperList.length = length;
    return wrapperList;
  }

  function addWrapNodeListMethod(wrapperConstructor, name) {
    wrapperConstructor.prototype[name] = function() {
      return wrapNodeList(this.impl[name].apply(this.impl, arguments));
    };
  }

  scope.wrappers.NodeList = NodeList;
  scope.addWrapNodeListMethod = addWrapNodeListMethod;
  scope.wrapNodeList = wrapNodeList;

})(window.ShadowDOMPolyfill);

/*
 * Copyright 2014 The Polymer Authors. All rights reserved.
 * Use of this source code is goverened by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(scope) {
  'use strict';

  // TODO(arv): Implement.

  scope.wrapHTMLCollection = scope.wrapNodeList;
  scope.wrappers.HTMLCollection = scope.wrappers.NodeList;

})(window.ShadowDOMPolyfill);

/**
 * Copyright 2012 The Polymer Authors. All rights reserved.
 * Use of this source code is goverened by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(scope) {
  'use strict';

  var EventTarget = scope.wrappers.EventTarget;
  var NodeList = scope.wrappers.NodeList;
  var TreeScope = scope.TreeScope;
  var assert = scope.assert;
  var defineWrapGetter = scope.defineWrapGetter;
  var enqueueMutation = scope.enqueueMutation;
  var getTreeScope = scope.getTreeScope;
  var isWrapper = scope.isWrapper;
  var mixin = scope.mixin;
  var registerTransientObservers = scope.registerTransientObservers;
  var registerWrapper = scope.registerWrapper;
  var setTreeScope = scope.setTreeScope;
  var unwrap = scope.unwrap;
  var unwrapIfNeeded = scope.unwrapIfNeeded;
  var wrap = scope.wrap;
  var wrapIfNeeded = scope.wrapIfNeeded;
  var wrappers = scope.wrappers;

  function assertIsNodeWrapper(node) {
    assert(node instanceof Node);
  }

  function createOneElementNodeList(node) {
    var nodes = new NodeList();
    nodes[0] = node;
    nodes.length = 1;
    return nodes;
  }

  var surpressMutations = false;

  /**
   * Called before node is inserted into a node to enqueue its removal from its
   * old parent.
   * @param {!Node} node The node that is about to be removed.
   * @param {!Node} parent The parent node that the node is being removed from.
   * @param {!NodeList} nodes The collected nodes.
   */
  function enqueueRemovalForInsertedNodes(node, parent, nodes) {
    enqueueMutation(parent, 'childList', {
      removedNodes: nodes,
      previousSibling: node.previousSibling,
      nextSibling: node.nextSibling
    });
  }

  function enqueueRemovalForInsertedDocumentFragment(df, nodes) {
    enqueueMutation(df, 'childList', {
      removedNodes: nodes
    });
  }

  /**
   * Collects nodes from a DocumentFragment or a Node for removal followed
   * by an insertion.
   *
   * This updates the internal pointers for node, previousNode and nextNode.
   */
  function collectNodes(node, parentNode, previousNode, nextNode) {
    if (node instanceof DocumentFragment) {
      var nodes = collectNodesForDocumentFragment(node);

      // The extra loop is to work around bugs with DocumentFragments in IE.
      surpressMutations = true;
      for (var i = nodes.length - 1; i >= 0; i--) {
        node.removeChild(nodes[i]);
        nodes[i].parentNode_ = parentNode;
      }
      surpressMutations = false;

      for (var i = 0; i < nodes.length; i++) {
        nodes[i].previousSibling_ = nodes[i - 1] || previousNode;
        nodes[i].nextSibling_ = nodes[i + 1] || nextNode;
      }

      if (previousNode)
        previousNode.nextSibling_ = nodes[0];
      if (nextNode)
        nextNode.previousSibling_ = nodes[nodes.length - 1];

      return nodes;
    }

    var nodes = createOneElementNodeList(node);
    var oldParent = node.parentNode;
    if (oldParent) {
      // This will enqueue the mutation record for the removal as needed.
      oldParent.removeChild(node);
    }

    node.parentNode_ = parentNode;
    node.previousSibling_ = previousNode;
    node.nextSibling_ = nextNode;
    if (previousNode)
      previousNode.nextSibling_ = node;
    if (nextNode)
      nextNode.previousSibling_ = node;

    return nodes;
  }

  function collectNodesNative(node) {
    if (node instanceof DocumentFragment)
      return collectNodesForDocumentFragment(node);

    var nodes = createOneElementNodeList(node);
    var oldParent = node.parentNode;
    if (oldParent)
      enqueueRemovalForInsertedNodes(node, oldParent, nodes);
    return nodes;
  }

  function collectNodesForDocumentFragment(node) {
    var nodes = new NodeList();
    var i = 0;
    for (var child = node.firstChild; child; child = child.nextSibling) {
      nodes[i++] = child;
    }
    nodes.length = i;
    enqueueRemovalForInsertedDocumentFragment(node, nodes);
    return nodes;
  }

  function snapshotNodeList(nodeList) {
    // NodeLists are not live at the moment so just return the same object.
    return nodeList;
  }

  // http://dom.spec.whatwg.org/#node-is-inserted
  function nodeWasAdded(node, treeScope) {
    setTreeScope(node, treeScope);
    node.nodeIsInserted_();
  }

  function nodesWereAdded(nodes, parent) {
    var treeScope = getTreeScope(parent);
    for (var i = 0; i < nodes.length; i++) {
      nodeWasAdded(nodes[i], treeScope);
    }
  }

  // http://dom.spec.whatwg.org/#node-is-removed
  function nodeWasRemoved(node) {
    setTreeScope(node, new TreeScope(node, null));
  }

  function nodesWereRemoved(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      nodeWasRemoved(nodes[i]);
    }
  }

  function ensureSameOwnerDocument(parent, child) {
    var ownerDoc = parent.nodeType === Node.DOCUMENT_NODE ?
        parent : parent.ownerDocument;
    if (ownerDoc !== child.ownerDocument)
      ownerDoc.adoptNode(child);
  }

  function adoptNodesIfNeeded(owner, nodes) {
    if (!nodes.length)
      return;

    var ownerDoc = owner.ownerDocument;

    // All nodes have the same ownerDocument when we get here.
    if (ownerDoc === nodes[0].ownerDocument)
      return;

    for (var i = 0; i < nodes.length; i++) {
      scope.adoptNodeNoRemove(nodes[i], ownerDoc);
    }
  }

  function unwrapNodesForInsertion(owner, nodes) {
    adoptNodesIfNeeded(owner, nodes);
    var length = nodes.length;

    if (length === 1)
      return unwrap(nodes[0]);

    var df = unwrap(owner.ownerDocument.createDocumentFragment());
    for (var i = 0; i < length; i++) {
      df.appendChild(unwrap(nodes[i]));
    }
    return df;
  }

  function clearChildNodes(wrapper) {
    if (wrapper.firstChild_ !== undefined) {
      var child = wrapper.firstChild_;
      while (child) {
        var tmp = child;
        child = child.nextSibling_;
        tmp.parentNode_ = tmp.previousSibling_ = tmp.nextSibling_ = undefined;
      }
    }
    wrapper.firstChild_ = wrapper.lastChild_ = undefined;
  }

  function removeAllChildNodes(wrapper) {
    if (wrapper.invalidateShadowRenderer()) {
      var childWrapper = wrapper.firstChild;
      while (childWrapper) {
        assert(childWrapper.parentNode === wrapper);
        var nextSibling = childWrapper.nextSibling;
        var childNode = unwrap(childWrapper);
        var parentNode = childNode.parentNode;
        if (parentNode)
          originalRemoveChild.call(parentNode, childNode);
        childWrapper.previousSibling_ = childWrapper.nextSibling_ =
            childWrapper.parentNode_ = null;
        childWrapper = nextSibling;
      }
      wrapper.firstChild_ = wrapper.lastChild_ = null;
    } else {
      var node = unwrap(wrapper);
      var child = node.firstChild;
      var nextSibling;
      while (child) {
        nextSibling = child.nextSibling;
        originalRemoveChild.call(node, child);
        child = nextSibling;
      }
    }
  }

  function invalidateParent(node) {
    var p = node.parentNode;
    return p && p.invalidateShadowRenderer();
  }

  function cleanupNodes(nodes) {
    for (var i = 0, n; i < nodes.length; i++) {
      n = nodes[i];
      n.parentNode.removeChild(n);
    }
  }

  var originalImportNode = document.importNode;
  var originalCloneNode = window.Node.prototype.cloneNode;

  function cloneNode(node, deep, opt_doc) {
    var clone;
    if (opt_doc)
      clone = wrap(originalImportNode.call(opt_doc, node.impl, false));
    else
      clone = wrap(originalCloneNode.call(node.impl, false));

    if (deep) {
      for (var child = node.firstChild; child; child = child.nextSibling) {
        clone.appendChild(cloneNode(child, true, opt_doc));
      }

      if (node instanceof wrappers.HTMLTemplateElement) {
        var cloneContent = clone.content;
        for (var child = node.content.firstChild;
             child;
             child = child.nextSibling) {
         cloneContent.appendChild(cloneNode(child, true, opt_doc));
        }
      }
    }
    // TODO(arv): Some HTML elements also clone other data like value.
    return clone;
  }

  function contains(self, child) {
    if (!child || getTreeScope(self) !== getTreeScope(child))
      return false;

    for (var node = child; node; node = node.parentNode) {
      if (node === self)
        return true;
    }
    return false;
  }

  var OriginalNode = window.Node;

  /**
   * This represents a wrapper of a native DOM node.
   * @param {!Node} original The original DOM node, aka, the visual DOM node.
   * @constructor
   * @extends {EventTarget}
   */
  function Node(original) {
    assert(original instanceof OriginalNode);

    EventTarget.call(this, original);

    // These properties are used to override the visual references with the
    // logical ones. If the value is undefined it means that the logical is the
    // same as the visual.

    /**
     * @type {Node|undefined}
     * @private
     */
    this.parentNode_ = undefined;

    /**
     * @type {Node|undefined}
     * @private
     */
    this.firstChild_ = undefined;

    /**
     * @type {Node|undefined}
     * @private
     */
    this.lastChild_ = undefined;

    /**
     * @type {Node|undefined}
     * @private
     */
    this.nextSibling_ = undefined;

    /**
     * @type {Node|undefined}
     * @private
     */
    this.previousSibling_ = undefined;

    this.treeScope_ = undefined;
  }

  var OriginalDocumentFragment = window.DocumentFragment;
  var originalAppendChild = OriginalNode.prototype.appendChild;
  var originalCompareDocumentPosition =
      OriginalNode.prototype.compareDocumentPosition;
  var originalInsertBefore = OriginalNode.prototype.insertBefore;
  var originalRemoveChild = OriginalNode.prototype.removeChild;
  var originalReplaceChild = OriginalNode.prototype.replaceChild;

  var isIe = /Trident/.test(navigator.userAgent);

  var removeChildOriginalHelper = isIe ?
      function(parent, child) {
        try {
          originalRemoveChild.call(parent, child);
        } catch (ex) {
          if (!(parent instanceof OriginalDocumentFragment))
            throw ex;
        }
      } :
      function(parent, child) {
        originalRemoveChild.call(parent, child);
      };

  Node.prototype = Object.create(EventTarget.prototype);
  mixin(Node.prototype, {
    appendChild: function(childWrapper) {
      return this.insertBefore(childWrapper, null);
    },

    insertBefore: function(childWrapper, refWrapper) {
      assertIsNodeWrapper(childWrapper);

      var refNode;
      if (refWrapper) {
        if (isWrapper(refWrapper)) {
          refNode = unwrap(refWrapper);
        } else {
          refNode = refWrapper;
          refWrapper = wrap(refNode);
        }
      } else {
        refWrapper = null;
        refNode = null;
      }

      refWrapper && assert(refWrapper.parentNode === this);

      var nodes;
      var previousNode =
          refWrapper ? refWrapper.previousSibling : this.lastChild;

      var useNative = !this.invalidateShadowRenderer() &&
                      !invalidateParent(childWrapper);

      if (useNative)
        nodes = collectNodesNative(childWrapper);
      else
        nodes = collectNodes(childWrapper, this, previousNode, refWrapper);

      if (useNative) {
        ensureSameOwnerDocument(this, childWrapper);
        clearChildNodes(this);
        originalInsertBefore.call(this.impl, unwrap(childWrapper), refNode);
      } else {
        if (!previousNode)
          this.firstChild_ = nodes[0];
        if (!refWrapper)
          this.lastChild_ = nodes[nodes.length - 1];

        var parentNode = refNode ? refNode.parentNode : this.impl;

        // insertBefore refWrapper no matter what the parent is?
        if (parentNode) {
          originalInsertBefore.call(parentNode,
              unwrapNodesForInsertion(this, nodes), refNode);
        } else {
          adoptNodesIfNeeded(this, nodes);
        }
      }

      enqueueMutation(this, 'childList', {
        addedNodes: nodes,
        nextSibling: refWrapper,
        previousSibling: previousNode
      });

      nodesWereAdded(nodes, this);

      return childWrapper;
    },

    removeChild: function(childWrapper) {
      assertIsNodeWrapper(childWrapper);
      if (childWrapper.parentNode !== this) {
        // IE has invalid DOM trees at times.
        var found = false;
        var childNodes = this.childNodes;
        for (var ieChild = this.firstChild; ieChild;
             ieChild = ieChild.nextSibling) {
          if (ieChild === childWrapper) {
            found = true;
            break;
          }
        }
        if (!found) {
          // TODO(arv): DOMException
          throw new Error('NotFoundError');
        }
      }

      var childNode = unwrap(childWrapper);
      var childWrapperNextSibling = childWrapper.nextSibling;
      var childWrapperPreviousSibling = childWrapper.previousSibling;

      if (this.invalidateShadowRenderer()) {
        // We need to remove the real node from the DOM before updating the
        // pointers. This is so that that mutation event is dispatched before
        // the pointers have changed.
        var thisFirstChild = this.firstChild;
        var thisLastChild = this.lastChild;

        var parentNode = childNode.parentNode;
        if (parentNode)
          removeChildOriginalHelper(parentNode, childNode);

        if (thisFirstChild === childWrapper)
          this.firstChild_ = childWrapperNextSibling;
        if (thisLastChild === childWrapper)
          this.lastChild_ = childWrapperPreviousSibling;
        if (childWrapperPreviousSibling)
          childWrapperPreviousSibling.nextSibling_ = childWrapperNextSibling;
        if (childWrapperNextSibling) {
          childWrapperNextSibling.previousSibling_ =
              childWrapperPreviousSibling;
        }

        childWrapper.previousSibling_ = childWrapper.nextSibling_ =
            childWrapper.parentNode_ = undefined;
      } else {
        clearChildNodes(this);
        removeChildOriginalHelper(this.impl, childNode);
      }

      if (!surpressMutations) {
        enqueueMutation(this, 'childList', {
          removedNodes: createOneElementNodeList(childWrapper),
          nextSibling: childWrapperNextSibling,
          previousSibling: childWrapperPreviousSibling
        });
      }

      registerTransientObservers(this, childWrapper);

      return childWrapper;
    },

    replaceChild: function(newChildWrapper, oldChildWrapper) {
      assertIsNodeWrapper(newChildWrapper);

      var oldChildNode;
      if (isWrapper(oldChildWrapper)) {
        oldChildNode = unwrap(oldChildWrapper);
      } else {
        oldChildNode = oldChildWrapper;
        oldChildWrapper = wrap(oldChildNode);
      }

      if (oldChildWrapper.parentNode !== this) {
        // TODO(arv): DOMException
        throw new Error('NotFoundError');
      }

      var nextNode = oldChildWrapper.nextSibling;
      var previousNode = oldChildWrapper.previousSibling;
      var nodes;

      var useNative = !this.invalidateShadowRenderer() &&
                      !invalidateParent(newChildWrapper);

      if (useNative) {
        nodes = collectNodesNative(newChildWrapper);
      } else {
        if (nextNode === newChildWrapper)
          nextNode = newChildWrapper.nextSibling;
        nodes = collectNodes(newChildWrapper, this, previousNode, nextNode);
      }

      if (!useNative) {
        if (this.firstChild === oldChildWrapper)
          this.firstChild_ = nodes[0];
        if (this.lastChild === oldChildWrapper)
          this.lastChild_ = nodes[nodes.length - 1];

        oldChildWrapper.previousSibling_ = oldChildWrapper.nextSibling_ =
            oldChildWrapper.parentNode_ = undefined;

        // replaceChild no matter what the parent is?
        if (oldChildNode.parentNode) {
          originalReplaceChild.call(
              oldChildNode.parentNode,
              unwrapNodesForInsertion(this, nodes),
              oldChildNode);
        }
      } else {
        ensureSameOwnerDocument(this, newChildWrapper);
        clearChildNodes(this);
        originalReplaceChild.call(this.impl, unwrap(newChildWrapper),
                                  oldChildNode);
      }

      enqueueMutation(this, 'childList', {
        addedNodes: nodes,
        removedNodes: createOneElementNodeList(oldChildWrapper),
        nextSibling: nextNode,
        previousSibling: previousNode
      });

      nodeWasRemoved(oldChildWrapper);
      nodesWereAdded(nodes, this);

      return oldChildWrapper;
    },

    /**
     * Called after a node was inserted. Subclasses override this to invalidate
     * the renderer as needed.
     * @private
     */
    nodeIsInserted_: function() {
      for (var child = this.firstChild; child; child = child.nextSibling) {
        child.nodeIsInserted_();
      }
    },

    hasChildNodes: function() {
      return this.firstChild !== null;
    },

    /** @type {Node} */
    get parentNode() {
      // If the parentNode has not been overridden, use the original parentNode.
      return this.parentNode_ !== undefined ?
          this.parentNode_ : wrap(this.impl.parentNode);
    },

    /** @type {Node} */
    get firstChild() {
      return this.firstChild_ !== undefined ?
          this.firstChild_ : wrap(this.impl.firstChild);
    },

    /** @type {Node} */
    get lastChild() {
      return this.lastChild_ !== undefined ?
          this.lastChild_ : wrap(this.impl.lastChild);
    },

    /** @type {Node} */
    get nextSibling() {
      return this.nextSibling_ !== undefined ?
          this.nextSibling_ : wrap(this.impl.nextSibling);
    },

    /** @type {Node} */
    get previousSibling() {
      return this.previousSibling_ !== undefined ?
          this.previousSibling_ : wrap(this.impl.previousSibling);
    },

    get parentElement() {
      var p = this.parentNode;
      while (p && p.nodeType !== Node.ELEMENT_NODE) {
        p = p.parentNode;
      }
      return p;
    },

    get textContent() {
      // TODO(arv): This should fallback to this.impl.textContent if there
      // are no shadow trees below or above the context node.
      var s = '';
      for (var child = this.firstChild; child; child = child.nextSibling) {
        if (child.nodeType != Node.COMMENT_NODE) {
          s += child.textContent;
        }
      }
      return s;
    },
    set textContent(textContent) {
      var removedNodes = snapshotNodeList(this.childNodes);

      if (this.invalidateShadowRenderer()) {
        removeAllChildNodes(this);
        if (textContent !== '') {
          var textNode = this.impl.ownerDocument.createTextNode(textContent);
          this.appendChild(textNode);
        }
      } else {
        clearChildNodes(this);
        this.impl.textContent = textContent;
      }

      var addedNodes = snapshotNodeList(this.childNodes);

      enqueueMutation(this, 'childList', {
        addedNodes: addedNodes,
        removedNodes: removedNodes
      });

      nodesWereRemoved(removedNodes);
      nodesWereAdded(addedNodes, this);
    },

    get childNodes() {
      var wrapperList = new NodeList();
      var i = 0;
      for (var child = this.firstChild; child; child = child.nextSibling) {
        wrapperList[i++] = child;
      }
      wrapperList.length = i;
      return wrapperList;
    },

    cloneNode: function(deep) {
      return cloneNode(this, deep);
    },

    contains: function(child) {
      return contains(this, wrapIfNeeded(child));
    },

    compareDocumentPosition: function(otherNode) {
      // This only wraps, it therefore only operates on the composed DOM and not
      // the logical DOM.
      return originalCompareDocumentPosition.call(this.impl,
                                                  unwrapIfNeeded(otherNode));
    },

    normalize: function() {
      var nodes = snapshotNodeList(this.childNodes);
      var remNodes = [];
      var s = '';
      var modNode;

      for (var i = 0, n; i < nodes.length; i++) {
        n = nodes[i];
        if (n.nodeType === Node.TEXT_NODE) {
          if (!modNode && !n.data.length)
            this.removeNode(n);
          else if (!modNode)
            modNode = n;
          else {
            s += n.data;
            remNodes.push(n);
          }
        } else {
          if (modNode && remNodes.length) {
            modNode.data += s;
            cleanUpNodes(remNodes);
          }
          remNodes = [];
          s = '';
          modNode = null;
          if (n.childNodes.length)
            n.normalize();
        }
      }

      // handle case where >1 text nodes are the last children
      if (modNode && remNodes.length) {
        modNode.data += s;
        cleanupNodes(remNodes);
      }
    }
  });

  defineWrapGetter(Node, 'ownerDocument');

  // We use a DocumentFragment as a base and then delete the properties of
  // DocumentFragment.prototype from the wrapper Node. Since delete makes
  // objects slow in some JS engines we recreate the prototype object.
  registerWrapper(OriginalNode, Node, document.createDocumentFragment());
  delete Node.prototype.querySelector;
  delete Node.prototype.querySelectorAll;
  Node.prototype = mixin(Object.create(EventTarget.prototype), Node.prototype);

  scope.cloneNode = cloneNode;
  scope.nodeWasAdded = nodeWasAdded;
  scope.nodeWasRemoved = nodeWasRemoved;
  scope.nodesWereAdded = nodesWereAdded;
  scope.nodesWereRemoved = nodesWereRemoved;
  scope.snapshotNodeList = snapshotNodeList;
  scope.wrappers.Node = Node;

})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var HTMLCollection = scope.wrappers.HTMLCollection;
  var NodeList = scope.wrappers.NodeList;

  function findOne(node, selector) {
    var m, el = node.firstElementChild;
    while (el) {
      if (el.matches(selector))
        return el;
      m = findOne(el, selector);
      if (m)
        return m;
      el = el.nextElementSibling;
    }
    return null;
  }

  function matchesSelector(el, selector) {
    return el.matches(selector);
  }

  var XHTML_NS = 'http://www.w3.org/1999/xhtml';

  function matchesTagName(el, localName, localNameLowerCase) {
    var ln = el.localName;
    return ln === localName ||
        ln === localNameLowerCase && el.namespaceURI === XHTML_NS;
  }

  function matchesEveryThing() {
    return true;
  }

  function matchesLocalName(el, localName) {
    return el.localName === localName;
  }

  function matchesNameSpace(el, ns) {
    return el.namespaceURI === ns;
  }

  function matchesLocalNameNS(el, ns, localName) {
    return el.namespaceURI === ns && el.localName === localName;
  }

  function findElements(node, result, p, arg0, arg1) {
    var el = node.firstElementChild;
    while (el) {
      if (p(el, arg0, arg1))
        result[result.length++] = el;
      findElements(el, result, p, arg0, arg1);
      el = el.nextElementSibling;
    }
    return result;
  }

  // find and findAll will only match Simple Selectors,
  // Structural Pseudo Classes are not guarenteed to be correct
  // http://www.w3.org/TR/css3-selectors/#simple-selectors

  var SelectorsInterface = {
    querySelector: function(selector) {
      return findOne(this, selector);
    },
    querySelectorAll: function(selector) {
      return findElements(this, new NodeList(), matchesSelector, selector);
    }
  };

  var GetElementsByInterface = {
    getElementsByTagName: function(localName) {
      var result = new HTMLCollection();
      if (localName === '*')
        return findElements(this, result, matchesEveryThing);

      return findElements(this, result,
          matchesTagName,
          localName,
          localName.toLowerCase());
    },

    getElementsByClassName: function(className) {
      // TODO(arv): Check className?
      return this.querySelectorAll('.' + className);
    },

    getElementsByTagNameNS: function(ns, localName) {
      var result = new HTMLCollection();

      if (ns === '') {
        ns = null;
      } else if (ns === '*') {
        if (localName === '*')
          return findElements(this, result, matchesEveryThing);
        return findElements(this, result, matchesLocalName, localName);
      }

      if (localName === '*')
        return findElements(this, result, matchesNameSpace, ns);

      return findElements(this, result, matchesLocalNameNS, ns, localName);
    }
  };

  scope.GetElementsByInterface = GetElementsByInterface;
  scope.SelectorsInterface = SelectorsInterface;

})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var NodeList = scope.wrappers.NodeList;

  function forwardElement(node) {
    while (node && node.nodeType !== Node.ELEMENT_NODE) {
      node = node.nextSibling;
    }
    return node;
  }

  function backwardsElement(node) {
    while (node && node.nodeType !== Node.ELEMENT_NODE) {
      node = node.previousSibling;
    }
    return node;
  }

  var ParentNodeInterface = {
    get firstElementChild() {
      return forwardElement(this.firstChild);
    },

    get lastElementChild() {
      return backwardsElement(this.lastChild);
    },

    get childElementCount() {
      var count = 0;
      for (var child = this.firstElementChild;
           child;
           child = child.nextElementSibling) {
        count++;
      }
      return count;
    },

    get children() {
      var wrapperList = new NodeList();
      var i = 0;
      for (var child = this.firstElementChild;
           child;
           child = child.nextElementSibling) {
        wrapperList[i++] = child;
      }
      wrapperList.length = i;
      return wrapperList;
    },

    remove: function() {
      var p = this.parentNode;
      if (p)
        p.removeChild(this);
    }
  };

  var ChildNodeInterface = {
    get nextElementSibling() {
      return forwardElement(this.nextSibling);
    },

    get previousElementSibling() {
      return backwardsElement(this.previousSibling);
    }
  };

  scope.ChildNodeInterface = ChildNodeInterface;
  scope.ParentNodeInterface = ParentNodeInterface;

})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var ChildNodeInterface = scope.ChildNodeInterface;
  var Node = scope.wrappers.Node;
  var enqueueMutation = scope.enqueueMutation;
  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;

  var OriginalCharacterData = window.CharacterData;

  function CharacterData(node) {
    Node.call(this, node);
  }
  CharacterData.prototype = Object.create(Node.prototype);
  mixin(CharacterData.prototype, {
    get textContent() {
      return this.data;
    },
    set textContent(value) {
      this.data = value;
    },
    get data() {
      return this.impl.data;
    },
    set data(value) {
      var oldValue = this.impl.data;
      enqueueMutation(this, 'characterData', {
        oldValue: oldValue
      });
      this.impl.data = value;
    }
  });

  mixin(CharacterData.prototype, ChildNodeInterface);

  registerWrapper(OriginalCharacterData, CharacterData,
                  document.createTextNode(''));

  scope.wrappers.CharacterData = CharacterData;
})(window.ShadowDOMPolyfill);

// Copyright 2014 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var CharacterData = scope.wrappers.CharacterData;
  var enqueueMutation = scope.enqueueMutation;
  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;

  function toUInt32(x) {
    return x >>> 0;
  }

  var OriginalText = window.Text;

  function Text(node) {
    CharacterData.call(this, node);
  }
  Text.prototype = Object.create(CharacterData.prototype);
  mixin(Text.prototype, {
    splitText: function(offset) {
      offset = toUInt32(offset);
      var s = this.data;
      if (offset > s.length)
        throw new Error('IndexSizeError');
      var head = s.slice(0, offset);
      var tail = s.slice(offset);
      this.data = head;
      var newTextNode = this.ownerDocument.createTextNode(tail);
      if (this.parentNode)
        this.parentNode.insertBefore(newTextNode, this.nextSibling);
      return newTextNode;
    }
  });

  registerWrapper(OriginalText, Text, document.createTextNode(''));

  scope.wrappers.Text = Text;
})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var ChildNodeInterface = scope.ChildNodeInterface;
  var GetElementsByInterface = scope.GetElementsByInterface;
  var Node = scope.wrappers.Node;
  var ParentNodeInterface = scope.ParentNodeInterface;
  var SelectorsInterface = scope.SelectorsInterface;
  var addWrapNodeListMethod = scope.addWrapNodeListMethod;
  var enqueueMutation = scope.enqueueMutation;
  var mixin = scope.mixin;
  var oneOf = scope.oneOf;
  var registerWrapper = scope.registerWrapper;
  var wrappers = scope.wrappers;

  var OriginalElement = window.Element;

  var matchesNames = [
    'matches',  // needs to come first.
    'mozMatchesSelector',
    'msMatchesSelector',
    'webkitMatchesSelector',
  ].filter(function(name) {
    return OriginalElement.prototype[name];
  });

  var matchesName = matchesNames[0];

  var originalMatches = OriginalElement.prototype[matchesName];

  function invalidateRendererBasedOnAttribute(element, name) {
    // Only invalidate if parent node is a shadow host.
    var p = element.parentNode;
    if (!p || !p.shadowRoot)
      return;

    var renderer = scope.getRendererForHost(p);
    if (renderer.dependsOnAttribute(name))
      renderer.invalidate();
  }

  function enqueAttributeChange(element, name, oldValue) {
    // This is not fully spec compliant. We should use localName (which might
    // have a different case than name) and the namespace (which requires us
    // to get the Attr object).
    enqueueMutation(element, 'attributes', {
      name: name,
      namespace: null,
      oldValue: oldValue
    });
  }

  function Element(node) {
    Node.call(this, node);
  }
  Element.prototype = Object.create(Node.prototype);
  mixin(Element.prototype, {
    createShadowRoot: function() {
      var newShadowRoot = new wrappers.ShadowRoot(this);
      this.impl.polymerShadowRoot_ = newShadowRoot;

      var renderer = scope.getRendererForHost(this);
      renderer.invalidate();

      return newShadowRoot;
    },

    get shadowRoot() {
      return this.impl.polymerShadowRoot_ || null;
    },

    setAttribute: function(name, value) {
      var oldValue = this.impl.getAttribute(name);
      this.impl.setAttribute(name, value);
      enqueAttributeChange(this, name, oldValue);
      invalidateRendererBasedOnAttribute(this, name);
    },

    removeAttribute: function(name) {
      var oldValue = this.impl.getAttribute(name);
      this.impl.removeAttribute(name);
      enqueAttributeChange(this, name, oldValue);
      invalidateRendererBasedOnAttribute(this, name);
    },

    matches: function(selector) {
      return originalMatches.call(this.impl, selector);
    }
  });

  matchesNames.forEach(function(name) {
    if (name !== 'matches') {
      Element.prototype[name] = function(selector) {
        return this.matches(selector);
      };
    }
  });

  if (OriginalElement.prototype.webkitCreateShadowRoot) {
    Element.prototype.webkitCreateShadowRoot =
        Element.prototype.createShadowRoot;
  }

  /**
   * Useful for generating the accessor pair for a property that reflects an
   * attribute.
   */
  function setterDirtiesAttribute(prototype, propertyName, opt_attrName) {
    var attrName = opt_attrName || propertyName;
    Object.defineProperty(prototype, propertyName, {
      get: function() {
        return this.impl[propertyName];
      },
      set: function(v) {
        this.impl[propertyName] = v;
        invalidateRendererBasedOnAttribute(this, attrName);
      },
      configurable: true,
      enumerable: true
    });
  }

  setterDirtiesAttribute(Element.prototype, 'id');
  setterDirtiesAttribute(Element.prototype, 'className', 'class');

  mixin(Element.prototype, ChildNodeInterface);
  mixin(Element.prototype, GetElementsByInterface);
  mixin(Element.prototype, ParentNodeInterface);
  mixin(Element.prototype, SelectorsInterface);

  registerWrapper(OriginalElement, Element,
                  document.createElementNS(null, 'x'));

  // TODO(arv): Export setterDirtiesAttribute and apply it to more bindings
  // that reflect attributes.
  scope.matchesNames = matchesNames;
  scope.wrappers.Element = Element;
})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var Element = scope.wrappers.Element;
  var defineGetter = scope.defineGetter;
  var enqueueMutation = scope.enqueueMutation;
  var mixin = scope.mixin;
  var nodesWereAdded = scope.nodesWereAdded;
  var nodesWereRemoved = scope.nodesWereRemoved;
  var registerWrapper = scope.registerWrapper;
  var snapshotNodeList = scope.snapshotNodeList;
  var unwrap = scope.unwrap;
  var wrap = scope.wrap;
  var wrappers = scope.wrappers;

  /////////////////////////////////////////////////////////////////////////////
  // innerHTML and outerHTML

  // http://www.whatwg.org/specs/web-apps/current-work/multipage/the-end.html#escapingString
  var escapeAttrRegExp = /[&\u00A0"]/g;
  var escapeDataRegExp = /[&\u00A0<>]/g;

  function escapeReplace(c) {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;'
      case '\u00A0':
        return '&nbsp;';
    }
  }

  function escapeAttr(s) {
    return s.replace(escapeAttrRegExp, escapeReplace);
  }

  function escapeData(s) {
    return s.replace(escapeDataRegExp, escapeReplace);
  }

  function makeSet(arr) {
    var set = {};
    for (var i = 0; i < arr.length; i++) {
      set[arr[i]] = true;
    }
    return set;
  }

  // http://www.whatwg.org/specs/web-apps/current-work/#void-elements
  var voidElements = makeSet([
    'area',
    'base',
    'br',
    'col',
    'command',
    'embed',
    'hr',
    'img',
    'input',
    'keygen',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr'
  ]);

  var plaintextParents = makeSet([
    'style',
    'script',
    'xmp',
    'iframe',
    'noembed',
    'noframes',
    'plaintext',
    'noscript'
  ]);

  function getOuterHTML(node, parentNode) {
    switch (node.nodeType) {
      case Node.ELEMENT_NODE:
        var tagName = node.tagName.toLowerCase();
        var s = '<' + tagName;
        var attrs = node.attributes;
        for (var i = 0, attr; attr = attrs[i]; i++) {
          s += ' ' + attr.name + '="' + escapeAttr(attr.value) + '"';
        }
        s += '>';
        if (voidElements[tagName])
          return s;

        return s + getInnerHTML(node) + '</' + tagName + '>';

      case Node.TEXT_NODE:
        var data = node.data;
        if (parentNode && plaintextParents[parentNode.localName])
          return data;
        return escapeData(data);

      case Node.COMMENT_NODE:
        return '<!--' + node.data + '-->';

      default:
        console.error(node);
        throw new Error('not implemented');
    }
  }

  function getInnerHTML(node) {
    if (node instanceof wrappers.HTMLTemplateElement)
      node = node.content;

    var s = '';
    for (var child = node.firstChild; child; child = child.nextSibling) {
      s += getOuterHTML(child, node);
    }
    return s;
  }

  function setInnerHTML(node, value, opt_tagName) {
    var tagName = opt_tagName || 'div';
    node.textContent = '';
    var tempElement = unwrap(node.ownerDocument.createElement(tagName));
    tempElement.innerHTML = value;
    var firstChild;
    while (firstChild = tempElement.firstChild) {
      node.appendChild(wrap(firstChild));
    }
  }

  // IE11 does not have MSIE in the user agent string.
  var oldIe = /MSIE/.test(navigator.userAgent);

  var OriginalHTMLElement = window.HTMLElement;
  var OriginalHTMLTemplateElement = window.HTMLTemplateElement;

  function HTMLElement(node) {
    Element.call(this, node);
  }
  HTMLElement.prototype = Object.create(Element.prototype);
  mixin(HTMLElement.prototype, {
    get innerHTML() {
      return getInnerHTML(this);
    },
    set innerHTML(value) {
      // IE9 does not handle set innerHTML correctly on plaintextParents. It
      // creates element children. For example
      //
      //   scriptElement.innerHTML = '<a>test</a>'
      //
      // Creates a single HTMLAnchorElement child.
      if (oldIe && plaintextParents[this.localName]) {
        this.textContent = value;
        return;
      }

      var removedNodes = snapshotNodeList(this.childNodes);

      if (this.invalidateShadowRenderer()) {
        if (this instanceof wrappers.HTMLTemplateElement)
          setInnerHTML(this.content, value);
        else
          setInnerHTML(this, value, this.tagName);

      // If we have a non native template element we need to handle this
      // manually since setting impl.innerHTML would add the html as direct
      // children and not be moved over to the content fragment.
      } else if (!OriginalHTMLTemplateElement &&
                 this instanceof wrappers.HTMLTemplateElement) {
        setInnerHTML(this.content, value);
      } else {
        this.impl.innerHTML = value;
      }

      var addedNodes = snapshotNodeList(this.childNodes);

      enqueueMutation(this, 'childList', {
        addedNodes: addedNodes,
        removedNodes: removedNodes
      });

      nodesWereRemoved(removedNodes);
      nodesWereAdded(addedNodes, this);
    },

    get outerHTML() {
      return getOuterHTML(this, this.parentNode);
    },
    set outerHTML(value) {
      var p = this.parentNode;
      if (p) {
        p.invalidateShadowRenderer();
        var df = frag(p, value);
        p.replaceChild(df, this);
      }
    },

    insertAdjacentHTML: function(position, text) {
      var contextElement, refNode;
      switch (String(position).toLowerCase()) {
        case 'beforebegin':
          contextElement = this.parentNode;
          refNode = this;
          break;
        case 'afterend':
          contextElement = this.parentNode;
          refNode = this.nextSibling;
          break;
        case 'afterbegin':
          contextElement = this;
          refNode = this.firstChild;
          break;
        case 'beforeend':
          contextElement = this;
          refNode = null;
          break;
        default:
          return;
      }

      var df = frag(contextElement, text);
      contextElement.insertBefore(df, refNode);
    }
  });

  function frag(contextElement, html) {
    // TODO(arv): This does not work with SVG and other non HTML elements.
    var p = unwrap(contextElement.cloneNode(false));
    p.innerHTML = html;
    var df = unwrap(document.createDocumentFragment());
    var c;
    while (c = p.firstChild) {
      df.appendChild(c);
    }
    return wrap(df);
  }

  function getter(name) {
    return function() {
      scope.renderAllPending();
      return this.impl[name];
    };
  }

  function getterRequiresRendering(name) {
    defineGetter(HTMLElement, name, getter(name));
  }

  [
    'clientHeight',
    'clientLeft',
    'clientTop',
    'clientWidth',
    'offsetHeight',
    'offsetLeft',
    'offsetTop',
    'offsetWidth',
    'scrollHeight',
    'scrollWidth',
  ].forEach(getterRequiresRendering);

  function getterAndSetterRequiresRendering(name) {
    Object.defineProperty(HTMLElement.prototype, name, {
      get: getter(name),
      set: function(v) {
        scope.renderAllPending();
        this.impl[name] = v;
      },
      configurable: true,
      enumerable: true
    });
  }

  [
    'scrollLeft',
    'scrollTop',
  ].forEach(getterAndSetterRequiresRendering);

  function methodRequiresRendering(name) {
    Object.defineProperty(HTMLElement.prototype, name, {
      value: function() {
        scope.renderAllPending();
        return this.impl[name].apply(this.impl, arguments);
      },
      configurable: true,
      enumerable: true
    });
  }

  [
    'getBoundingClientRect',
    'getClientRects',
    'scrollIntoView'
  ].forEach(methodRequiresRendering);

  // HTMLElement is abstract so we use a subclass that has no members.
  registerWrapper(OriginalHTMLElement, HTMLElement,
                  document.createElement('b'));

  scope.wrappers.HTMLElement = HTMLElement;

  // TODO: Find a better way to share these two with WrapperShadowRoot.
  scope.getInnerHTML = getInnerHTML;
  scope.setInnerHTML = setInnerHTML
})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var HTMLElement = scope.wrappers.HTMLElement;
  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;
  var wrap = scope.wrap;

  var OriginalHTMLCanvasElement = window.HTMLCanvasElement;

  function HTMLCanvasElement(node) {
    HTMLElement.call(this, node);
  }
  HTMLCanvasElement.prototype = Object.create(HTMLElement.prototype);

  mixin(HTMLCanvasElement.prototype, {
    getContext: function() {
      var context = this.impl.getContext.apply(this.impl, arguments);
      return context && wrap(context);
    }
  });

  registerWrapper(OriginalHTMLCanvasElement, HTMLCanvasElement,
                  document.createElement('canvas'));

  scope.wrappers.HTMLCanvasElement = HTMLCanvasElement;
})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var HTMLElement = scope.wrappers.HTMLElement;
  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;

  var OriginalHTMLContentElement = window.HTMLContentElement;

  function HTMLContentElement(node) {
    HTMLElement.call(this, node);
  }
  HTMLContentElement.prototype = Object.create(HTMLElement.prototype);
  mixin(HTMLContentElement.prototype, {
    get select() {
      return this.getAttribute('select');
    },
    set select(value) {
      this.setAttribute('select', value);
    },

    setAttribute: function(n, v) {
      HTMLElement.prototype.setAttribute.call(this, n, v);
      if (String(n).toLowerCase() === 'select')
        this.invalidateShadowRenderer(true);
    }

    // getDistributedNodes is added in ShadowRenderer

    // TODO: attribute boolean resetStyleInheritance;
  });

  if (OriginalHTMLContentElement)
    registerWrapper(OriginalHTMLContentElement, HTMLContentElement);

  scope.wrappers.HTMLContentElement = HTMLContentElement;
})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var HTMLElement = scope.wrappers.HTMLElement;
  var registerWrapper = scope.registerWrapper;
  var unwrap = scope.unwrap;
  var rewrap = scope.rewrap;

  var OriginalHTMLImageElement = window.HTMLImageElement;

  function HTMLImageElement(node) {
    HTMLElement.call(this, node);
  }
  HTMLImageElement.prototype = Object.create(HTMLElement.prototype);

  registerWrapper(OriginalHTMLImageElement, HTMLImageElement,
                  document.createElement('img'));

  function Image(width, height) {
    if (!(this instanceof Image)) {
      throw new TypeError(
          'DOM object constructor cannot be called as a function.');
    }

    var node = unwrap(document.createElement('img'));
    HTMLElement.call(this, node);
    rewrap(node, this);

    if (width !== undefined)
      node.width = width;
    if (height !== undefined)
      node.height = height;
  }

  Image.prototype = HTMLImageElement.prototype;

  scope.wrappers.HTMLImageElement = HTMLImageElement;
  scope.wrappers.Image = Image;
})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var HTMLElement = scope.wrappers.HTMLElement;
  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;

  var OriginalHTMLShadowElement = window.HTMLShadowElement;

  function HTMLShadowElement(node) {
    HTMLElement.call(this, node);
  }
  HTMLShadowElement.prototype = Object.create(HTMLElement.prototype);
  mixin(HTMLShadowElement.prototype, {
    // TODO: attribute boolean resetStyleInheritance;
  });

  if (OriginalHTMLShadowElement)
    registerWrapper(OriginalHTMLShadowElement, HTMLShadowElement);

  scope.wrappers.HTMLShadowElement = HTMLShadowElement;
})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var HTMLElement = scope.wrappers.HTMLElement;
  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;
  var unwrap = scope.unwrap;
  var wrap = scope.wrap;

  var contentTable = new WeakMap();
  var templateContentsOwnerTable = new WeakMap();

  // http://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/templates/index.html#dfn-template-contents-owner
  function getTemplateContentsOwner(doc) {
    if (!doc.defaultView)
      return doc;
    var d = templateContentsOwnerTable.get(doc);
    if (!d) {
      // TODO(arv): This should either be a Document or HTMLDocument depending
      // on doc.
      d = doc.implementation.createHTMLDocument('');
      while (d.lastChild) {
        d.removeChild(d.lastChild);
      }
      templateContentsOwnerTable.set(doc, d);
    }
    return d;
  }

  function extractContent(templateElement) {
    // templateElement is not a wrapper here.
    var doc = getTemplateContentsOwner(templateElement.ownerDocument);
    var df = unwrap(doc.createDocumentFragment());
    var child;
    while (child = templateElement.firstChild) {
      df.appendChild(child);
    }
    return df;
  }

  var OriginalHTMLTemplateElement = window.HTMLTemplateElement;

  function HTMLTemplateElement(node) {
    HTMLElement.call(this, node);
    if (!OriginalHTMLTemplateElement) {
      var content = extractContent(node);
      contentTable.set(this, wrap(content));
    }
  }
  HTMLTemplateElement.prototype = Object.create(HTMLElement.prototype);

  mixin(HTMLTemplateElement.prototype, {
    get content() {
      if (OriginalHTMLTemplateElement)
        return wrap(this.impl.content);
      return contentTable.get(this);
    },

    // TODO(arv): cloneNode needs to clone content.

  });

  if (OriginalHTMLTemplateElement)
    registerWrapper(OriginalHTMLTemplateElement, HTMLTemplateElement);

  scope.wrappers.HTMLTemplateElement = HTMLTemplateElement;
})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var HTMLElement = scope.wrappers.HTMLElement;
  var registerWrapper = scope.registerWrapper;

  var OriginalHTMLMediaElement = window.HTMLMediaElement;

  function HTMLMediaElement(node) {
    HTMLElement.call(this, node);
  }
  HTMLMediaElement.prototype = Object.create(HTMLElement.prototype);

  registerWrapper(OriginalHTMLMediaElement, HTMLMediaElement,
                  document.createElement('audio'));

  scope.wrappers.HTMLMediaElement = HTMLMediaElement;
})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var HTMLMediaElement = scope.wrappers.HTMLMediaElement;
  var registerWrapper = scope.registerWrapper;
  var unwrap = scope.unwrap;
  var rewrap = scope.rewrap;

  var OriginalHTMLAudioElement = window.HTMLAudioElement;

  function HTMLAudioElement(node) {
    HTMLMediaElement.call(this, node);
  }
  HTMLAudioElement.prototype = Object.create(HTMLMediaElement.prototype);

  registerWrapper(OriginalHTMLAudioElement, HTMLAudioElement,
                  document.createElement('audio'));

  function Audio(src) {
    if (!(this instanceof Audio)) {
      throw new TypeError(
          'DOM object constructor cannot be called as a function.');
    }

    var node = unwrap(document.createElement('audio'));
    HTMLMediaElement.call(this, node);
    rewrap(node, this);

    node.setAttribute('preload', 'auto');
    if (src !== undefined)
      node.setAttribute('src', src);
  }

  Audio.prototype = HTMLAudioElement.prototype;

  scope.wrappers.HTMLAudioElement = HTMLAudioElement;
  scope.wrappers.Audio = Audio;
})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var HTMLElement = scope.wrappers.HTMLElement;
  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;
  var rewrap = scope.rewrap;
  var unwrap = scope.unwrap;
  var wrap = scope.wrap;

  var OriginalHTMLOptionElement = window.HTMLOptionElement;

  function trimText(s) {
    return s.replace(/\s+/g, ' ').trim();
  }

  function HTMLOptionElement(node) {
    HTMLElement.call(this, node);
  }
  HTMLOptionElement.prototype = Object.create(HTMLElement.prototype);
  mixin(HTMLOptionElement.prototype, {
    get text() {
      return trimText(this.textContent);
    },
    set text(value) {
      this.textContent = trimText(String(value));
    },
    get form() {
      return wrap(unwrap(this).form);
    }
  });

  registerWrapper(OriginalHTMLOptionElement, HTMLOptionElement,
                  document.createElement('option'));

  function Option(text, value, defaultSelected, selected) {
    if (!(this instanceof Option)) {
      throw new TypeError(
          'DOM object constructor cannot be called as a function.');
    }

    var node = unwrap(document.createElement('option'));
    HTMLElement.call(this, node);
    rewrap(node, this);

    if (text !== undefined)
      node.text = text;
    if (value !== undefined)
      node.setAttribute('value', value);
    if (defaultSelected === true)
      node.setAttribute('selected', '');
    node.selected = selected === true;
  }

  Option.prototype = HTMLOptionElement.prototype;

  scope.wrappers.HTMLOptionElement = HTMLOptionElement;
  scope.wrappers.Option = Option;
})(window.ShadowDOMPolyfill);

// Copyright 2014 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var HTMLElement = scope.wrappers.HTMLElement;
  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;
  var unwrap = scope.unwrap;
  var wrap = scope.wrap;

  var OriginalHTMLSelectElement = window.HTMLSelectElement;

  function HTMLSelectElement(node) {
    HTMLElement.call(this, node);
  }
  HTMLSelectElement.prototype = Object.create(HTMLElement.prototype);
  mixin(HTMLSelectElement.prototype, {
    add: function(element, before) {
      if (typeof before === 'object')  // also includes null
        before = unwrap(before);
      unwrap(this).add(unwrap(element), before);
    },

    remove: function(indexOrNode) {
      // Spec only allows index but implementations allow index or node.
      // remove() is also allowed which is same as remove(undefined)
      if (indexOrNode === undefined) {
        HTMLElement.prototype.remove.call(this);
        return;
      }

      if (typeof indexOrNode === 'object')
        indexOrNode = unwrap(indexOrNode);

      unwrap(this).remove(indexOrNode);
    },

    get form() {
      return wrap(unwrap(this).form);
    }
  });

  registerWrapper(OriginalHTMLSelectElement, HTMLSelectElement,
                  document.createElement('select'));

  scope.wrappers.HTMLSelectElement = HTMLSelectElement;
})(window.ShadowDOMPolyfill);

/*
 * Copyright 2014 The Polymer Authors. All rights reserved.
 * Use of this source code is goverened by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(scope) {
  'use strict';

  var HTMLElement = scope.wrappers.HTMLElement;
  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;
  var unwrap = scope.unwrap;
  var wrap = scope.wrap;
  var wrapHTMLCollection = scope.wrapHTMLCollection;

  var OriginalHTMLTableElement = window.HTMLTableElement;

  function HTMLTableElement(node) {
    HTMLElement.call(this, node);
  }
  HTMLTableElement.prototype = Object.create(HTMLElement.prototype);
  mixin(HTMLTableElement.prototype, {
    get caption() {
      return wrap(unwrap(this).caption);
    },
    createCaption: function() {
      return wrap(unwrap(this).createCaption());
    },

    get tHead() {
      return wrap(unwrap(this).tHead);
    },
    createTHead: function() {
      return wrap(unwrap(this).createTHead());
    },

    createTFoot: function() {
      return wrap(unwrap(this).createTFoot());
    },
    get tFoot() {
      return wrap(unwrap(this).tFoot);
    },

    get tBodies() {
      return wrapHTMLCollection(unwrap(this).tBodies);
    },
    createTBody: function() {
      return wrap(unwrap(this).createTBody());
    },

    get rows() {
      return wrapHTMLCollection(unwrap(this).rows);
    },
    insertRow: function(index) {
      return wrap(unwrap(this).insertRow(index));
    }
  });

  registerWrapper(OriginalHTMLTableElement, HTMLTableElement,
                  document.createElement('table'));

  scope.wrappers.HTMLTableElement = HTMLTableElement;
})(window.ShadowDOMPolyfill);

/*
 * Copyright 2014 The Polymer Authors. All rights reserved.
 * Use of this source code is goverened by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(scope) {
  'use strict';

  var HTMLElement = scope.wrappers.HTMLElement;
  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;
  var wrapHTMLCollection = scope.wrapHTMLCollection;
  var unwrap = scope.unwrap;
  var wrap = scope.wrap;

  var OriginalHTMLTableSectionElement = window.HTMLTableSectionElement;

  function HTMLTableSectionElement(node) {
    HTMLElement.call(this, node);
  }
  HTMLTableSectionElement.prototype = Object.create(HTMLElement.prototype);
  mixin(HTMLTableSectionElement.prototype, {
    get rows() {
      return wrapHTMLCollection(unwrap(this).rows);
    },
    insertRow: function(index) {
      return wrap(unwrap(this).insertRow(index));
    }
  });

  registerWrapper(OriginalHTMLTableSectionElement, HTMLTableSectionElement,
                  document.createElement('thead'));

  scope.wrappers.HTMLTableSectionElement = HTMLTableSectionElement;
})(window.ShadowDOMPolyfill);

/*
 * Copyright 2014 The Polymer Authors. All rights reserved.
 * Use of this source code is goverened by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(scope) {
  'use strict';

  var HTMLElement = scope.wrappers.HTMLElement;
  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;
  var wrapHTMLCollection = scope.wrapHTMLCollection;
  var unwrap = scope.unwrap;
  var wrap = scope.wrap;

  var OriginalHTMLTableRowElement = window.HTMLTableRowElement;

  function HTMLTableRowElement(node) {
    HTMLElement.call(this, node);
  }
  HTMLTableRowElement.prototype = Object.create(HTMLElement.prototype);
  mixin(HTMLTableRowElement.prototype, {
    get cells() {
      return wrapHTMLCollection(unwrap(this).cells);
    },

    insertCell: function(index) {
      return wrap(unwrap(this).insertCell(index));
    }
  });

  registerWrapper(OriginalHTMLTableRowElement, HTMLTableRowElement,
                  document.createElement('tr'));

  scope.wrappers.HTMLTableRowElement = HTMLTableRowElement;
})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var HTMLContentElement = scope.wrappers.HTMLContentElement;
  var HTMLElement = scope.wrappers.HTMLElement;
  var HTMLShadowElement = scope.wrappers.HTMLShadowElement;
  var HTMLTemplateElement = scope.wrappers.HTMLTemplateElement;
  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;

  var OriginalHTMLUnknownElement = window.HTMLUnknownElement;

  function HTMLUnknownElement(node) {
    switch (node.localName) {
      case 'content':
        return new HTMLContentElement(node);
      case 'shadow':
        return new HTMLShadowElement(node);
      case 'template':
        return new HTMLTemplateElement(node);
    }
    HTMLElement.call(this, node);
  }
  HTMLUnknownElement.prototype = Object.create(HTMLElement.prototype);
  registerWrapper(OriginalHTMLUnknownElement, HTMLUnknownElement);
  scope.wrappers.HTMLUnknownElement = HTMLUnknownElement;
})(window.ShadowDOMPolyfill);

// Copyright 2014 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var registerObject = scope.registerObject;

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var svgTitleElement = document.createElementNS(SVG_NS, 'title');
  var SVGTitleElement = registerObject(svgTitleElement);
  var SVGElement = Object.getPrototypeOf(SVGTitleElement.prototype).constructor;

  scope.wrappers.SVGElement = SVGElement;
})(window.ShadowDOMPolyfill);

// Copyright 2014 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;
  var unwrap = scope.unwrap;
  var wrap = scope.wrap;

  var OriginalSVGUseElement = window.SVGUseElement;

  // IE uses SVGElement as parent interface, SVG2 (Blink & Gecko) uses
  // SVGGraphicsElement. Use the <g> element to get the right prototype.

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var gWrapper = wrap(document.createElementNS(SVG_NS, 'g'));
  var useElement = document.createElementNS(SVG_NS, 'use');
  var SVGGElement = gWrapper.constructor;
  var parentInterfacePrototype = Object.getPrototypeOf(SVGGElement.prototype);
  var parentInterface = parentInterfacePrototype.constructor;

  function SVGUseElement(impl) {
    parentInterface.call(this, impl);
  }

  SVGUseElement.prototype = Object.create(parentInterfacePrototype);

  // Firefox does not expose instanceRoot.
  if ('instanceRoot' in useElement) {
    mixin(SVGUseElement.prototype, {
      get instanceRoot() {
        return wrap(unwrap(this).instanceRoot);
      },
      get animatedInstanceRoot() {
        return wrap(unwrap(this).animatedInstanceRoot);
      },
    });
  }

  registerWrapper(OriginalSVGUseElement, SVGUseElement, useElement);

  scope.wrappers.SVGUseElement = SVGUseElement;
})(window.ShadowDOMPolyfill);

// Copyright 2014 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var EventTarget = scope.wrappers.EventTarget;
  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;
  var wrap = scope.wrap;

  var OriginalSVGElementInstance = window.SVGElementInstance;
  if (!OriginalSVGElementInstance)
    return;

  function SVGElementInstance(impl) {
    EventTarget.call(this, impl);
  }

  SVGElementInstance.prototype = Object.create(EventTarget.prototype);
  mixin(SVGElementInstance.prototype, {
    /** @type {SVGElement} */
    get correspondingElement() {
      return wrap(this.impl.correspondingElement);
    },

    /** @type {SVGUseElement} */
    get correspondingUseElement() {
      return wrap(this.impl.correspondingUseElement);
    },

    /** @type {SVGElementInstance} */
    get parentNode() {
      return wrap(this.impl.parentNode);
    },

    /** @type {SVGElementInstanceList} */
    get childNodes() {
      throw new Error('Not implemented');
    },

    /** @type {SVGElementInstance} */
    get firstChild() {
      return wrap(this.impl.firstChild);
    },

    /** @type {SVGElementInstance} */
    get lastChild() {
      return wrap(this.impl.lastChild);
    },

    /** @type {SVGElementInstance} */
    get previousSibling() {
      return wrap(this.impl.previousSibling);
    },

    /** @type {SVGElementInstance} */
    get nextSibling() {
      return wrap(this.impl.nextSibling);
    }
  });

  registerWrapper(OriginalSVGElementInstance, SVGElementInstance);

  scope.wrappers.SVGElementInstance = SVGElementInstance;
})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;
  var unwrap = scope.unwrap;
  var unwrapIfNeeded = scope.unwrapIfNeeded;
  var wrap = scope.wrap;

  var OriginalCanvasRenderingContext2D = window.CanvasRenderingContext2D;

  function CanvasRenderingContext2D(impl) {
    this.impl = impl;
  }

  mixin(CanvasRenderingContext2D.prototype, {
    get canvas() {
      return wrap(this.impl.canvas);
    },

    drawImage: function() {
      arguments[0] = unwrapIfNeeded(arguments[0]);
      this.impl.drawImage.apply(this.impl, arguments);
    },

    createPattern: function() {
      arguments[0] = unwrap(arguments[0]);
      return this.impl.createPattern.apply(this.impl, arguments);
    }
  });

  registerWrapper(OriginalCanvasRenderingContext2D, CanvasRenderingContext2D,
                  document.createElement('canvas').getContext('2d'));

  scope.wrappers.CanvasRenderingContext2D = CanvasRenderingContext2D;
})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;
  var unwrapIfNeeded = scope.unwrapIfNeeded;
  var wrap = scope.wrap;

  var OriginalWebGLRenderingContext = window.WebGLRenderingContext;

  // IE10 does not have WebGL.
  if (!OriginalWebGLRenderingContext)
    return;

  function WebGLRenderingContext(impl) {
    this.impl = impl;
  }

  mixin(WebGLRenderingContext.prototype, {
    get canvas() {
      return wrap(this.impl.canvas);
    },

    texImage2D: function() {
      arguments[5] = unwrapIfNeeded(arguments[5]);
      this.impl.texImage2D.apply(this.impl, arguments);
    },

    texSubImage2D: function() {
      arguments[6] = unwrapIfNeeded(arguments[6]);
      this.impl.texSubImage2D.apply(this.impl, arguments);
    }
  });

  // Blink/WebKit has broken DOM bindings. Usually we would create an instance
  // of the object and pass it into registerWrapper as a "blueprint" but
  // creating WebGL contexts is expensive and might fail so we use a dummy
  // object with dummy instance properties for these broken browsers.
  var instanceProperties = /WebKit/.test(navigator.userAgent) ?
      {drawingBufferHeight: null, drawingBufferWidth: null} : {};

  registerWrapper(OriginalWebGLRenderingContext, WebGLRenderingContext,
      instanceProperties);

  scope.wrappers.WebGLRenderingContext = WebGLRenderingContext;
})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var registerWrapper = scope.registerWrapper;
  var unwrap = scope.unwrap;
  var unwrapIfNeeded = scope.unwrapIfNeeded;
  var wrap = scope.wrap;

  var OriginalRange = window.Range;

  function Range(impl) {
    this.impl = impl;
  }
  Range.prototype = {
    get startContainer() {
      return wrap(this.impl.startContainer);
    },
    get endContainer() {
      return wrap(this.impl.endContainer);
    },
    get commonAncestorContainer() {
      return wrap(this.impl.commonAncestorContainer);
    },
    setStart: function(refNode,offset) {
      this.impl.setStart(unwrapIfNeeded(refNode), offset);
    },
    setEnd: function(refNode,offset) {
      this.impl.setEnd(unwrapIfNeeded(refNode), offset);
    },
    setStartBefore: function(refNode) {
      this.impl.setStartBefore(unwrapIfNeeded(refNode));
    },
    setStartAfter: function(refNode) {
      this.impl.setStartAfter(unwrapIfNeeded(refNode));
    },
    setEndBefore: function(refNode) {
      this.impl.setEndBefore(unwrapIfNeeded(refNode));
    },
    setEndAfter: function(refNode) {
      this.impl.setEndAfter(unwrapIfNeeded(refNode));
    },
    selectNode: function(refNode) {
      this.impl.selectNode(unwrapIfNeeded(refNode));
    },
    selectNodeContents: function(refNode) {
      this.impl.selectNodeContents(unwrapIfNeeded(refNode));
    },
    compareBoundaryPoints: function(how, sourceRange) {
      return this.impl.compareBoundaryPoints(how, unwrap(sourceRange));
    },
    extractContents: function() {
      return wrap(this.impl.extractContents());
    },
    cloneContents: function() {
      return wrap(this.impl.cloneContents());
    },
    insertNode: function(node) {
      this.impl.insertNode(unwrapIfNeeded(node));
    },
    surroundContents: function(newParent) {
      this.impl.surroundContents(unwrapIfNeeded(newParent));
    },
    cloneRange: function() {
      return wrap(this.impl.cloneRange());
    },
    isPointInRange: function(node, offset) {
      return this.impl.isPointInRange(unwrapIfNeeded(node), offset);
    },
    comparePoint: function(node, offset) {
      return this.impl.comparePoint(unwrapIfNeeded(node), offset);
    },
    intersectsNode: function(node) {
      return this.impl.intersectsNode(unwrapIfNeeded(node));
    },
    toString: function() {
      return this.impl.toString();
    }
  };

  // IE9 does not have createContextualFragment.
  if (OriginalRange.prototype.createContextualFragment) {
    Range.prototype.createContextualFragment = function(html) {
      return wrap(this.impl.createContextualFragment(html));
    };
  }

  registerWrapper(window.Range, Range, document.createRange());

  scope.wrappers.Range = Range;

})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var GetElementsByInterface = scope.GetElementsByInterface;
  var ParentNodeInterface = scope.ParentNodeInterface;
  var SelectorsInterface = scope.SelectorsInterface;
  var mixin = scope.mixin;
  var registerObject = scope.registerObject;

  var DocumentFragment = registerObject(document.createDocumentFragment());
  mixin(DocumentFragment.prototype, ParentNodeInterface);
  mixin(DocumentFragment.prototype, SelectorsInterface);
  mixin(DocumentFragment.prototype, GetElementsByInterface);

  var Comment = registerObject(document.createComment(''));

  scope.wrappers.Comment = Comment;
  scope.wrappers.DocumentFragment = DocumentFragment;

})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var DocumentFragment = scope.wrappers.DocumentFragment;
  var TreeScope = scope.TreeScope;
  var elementFromPoint = scope.elementFromPoint;
  var getInnerHTML = scope.getInnerHTML;
  var getTreeScope = scope.getTreeScope;
  var mixin = scope.mixin;
  var rewrap = scope.rewrap;
  var setInnerHTML = scope.setInnerHTML;
  var unwrap = scope.unwrap;

  var shadowHostTable = new WeakMap();
  var nextOlderShadowTreeTable = new WeakMap();

  var spaceCharRe = /[ \t\n\r\f]/;

  function ShadowRoot(hostWrapper) {
    var node = unwrap(hostWrapper.impl.ownerDocument.createDocumentFragment());
    DocumentFragment.call(this, node);

    // createDocumentFragment associates the node with a wrapper
    // DocumentFragment instance. Override that.
    rewrap(node, this);

    this.treeScope_ = new TreeScope(this, getTreeScope(hostWrapper));

    var oldShadowRoot = hostWrapper.shadowRoot;
    nextOlderShadowTreeTable.set(this, oldShadowRoot);

    shadowHostTable.set(this, hostWrapper);
  }
  ShadowRoot.prototype = Object.create(DocumentFragment.prototype);
  mixin(ShadowRoot.prototype, {
    get innerHTML() {
      return getInnerHTML(this);
    },
    set innerHTML(value) {
      setInnerHTML(this, value);
      this.invalidateShadowRenderer();
    },

    get olderShadowRoot() {
      return nextOlderShadowTreeTable.get(this) || null;
    },

    get host() {
      return shadowHostTable.get(this) || null;
    },

    invalidateShadowRenderer: function() {
      return shadowHostTable.get(this).invalidateShadowRenderer();
    },

    elementFromPoint: function(x, y) {
      return elementFromPoint(this, this.ownerDocument, x, y);
    },

    getElementById: function(id) {
      if (spaceCharRe.test(id))
        return null;
      return this.querySelector('[id="' + id + '"]');
    }
  });

  scope.wrappers.ShadowRoot = ShadowRoot;

})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var Element = scope.wrappers.Element;
  var HTMLContentElement = scope.wrappers.HTMLContentElement;
  var HTMLShadowElement = scope.wrappers.HTMLShadowElement;
  var Node = scope.wrappers.Node;
  var ShadowRoot = scope.wrappers.ShadowRoot;
  var assert = scope.assert;
  var getTreeScope = scope.getTreeScope;
  var mixin = scope.mixin;
  var oneOf = scope.oneOf;
  var unwrap = scope.unwrap;
  var wrap = scope.wrap;

  /**
   * Updates the fields of a wrapper to a snapshot of the logical DOM as needed.
   * Up means parentNode
   * Sideways means previous and next sibling.
   * @param {!Node} wrapper
   */
  function updateWrapperUpAndSideways(wrapper) {
    wrapper.previousSibling_ = wrapper.previousSibling;
    wrapper.nextSibling_ = wrapper.nextSibling;
    wrapper.parentNode_ = wrapper.parentNode;
  }

  /**
   * Updates the fields of a wrapper to a snapshot of the logical DOM as needed.
   * Down means first and last child
   * @param {!Node} wrapper
   */
  function updateWrapperDown(wrapper) {
    wrapper.firstChild_ = wrapper.firstChild;
    wrapper.lastChild_ = wrapper.lastChild;
  }

  function updateAllChildNodes(parentNodeWrapper) {
    assert(parentNodeWrapper instanceof Node);
    for (var childWrapper = parentNodeWrapper.firstChild;
         childWrapper;
         childWrapper = childWrapper.nextSibling) {
      updateWrapperUpAndSideways(childWrapper);
    }
    updateWrapperDown(parentNodeWrapper);
  }

  function insertBefore(parentNodeWrapper, newChildWrapper, refChildWrapper) {
    var parentNode = unwrap(parentNodeWrapper);
    var newChild = unwrap(newChildWrapper);
    var refChild = refChildWrapper ? unwrap(refChildWrapper) : null;

    remove(newChildWrapper);
    updateWrapperUpAndSideways(newChildWrapper);

    if (!refChildWrapper) {
      parentNodeWrapper.lastChild_ = parentNodeWrapper.lastChild;
      if (parentNodeWrapper.lastChild === parentNodeWrapper.firstChild)
        parentNodeWrapper.firstChild_ = parentNodeWrapper.firstChild;

      var lastChildWrapper = wrap(parentNode.lastChild);
      if (lastChildWrapper)
        lastChildWrapper.nextSibling_ = lastChildWrapper.nextSibling;
    } else {
      if (parentNodeWrapper.firstChild === refChildWrapper)
        parentNodeWrapper.firstChild_ = refChildWrapper;

      refChildWrapper.previousSibling_ = refChildWrapper.previousSibling;
    }

    parentNode.insertBefore(newChild, refChild);
  }

  function remove(nodeWrapper) {
    var node = unwrap(nodeWrapper)
    var parentNode = node.parentNode;
    if (!parentNode)
      return;

    var parentNodeWrapper = wrap(parentNode);
    updateWrapperUpAndSideways(nodeWrapper);

    if (nodeWrapper.previousSibling)
      nodeWrapper.previousSibling.nextSibling_ = nodeWrapper;
    if (nodeWrapper.nextSibling)
      nodeWrapper.nextSibling.previousSibling_ = nodeWrapper;

    if (parentNodeWrapper.lastChild === nodeWrapper)
      parentNodeWrapper.lastChild_ = nodeWrapper;
    if (parentNodeWrapper.firstChild === nodeWrapper)
      parentNodeWrapper.firstChild_ = nodeWrapper;

    parentNode.removeChild(node);
  }

  var distributedChildNodesTable = new WeakMap();
  var eventParentsTable = new WeakMap();
  var insertionParentTable = new WeakMap();
  var rendererForHostTable = new WeakMap();

  function distributeChildToInsertionPoint(child, insertionPoint) {
    getDistributedChildNodes(insertionPoint).push(child);
    assignToInsertionPoint(child, insertionPoint);

    var eventParents = eventParentsTable.get(child);
    if (!eventParents)
      eventParentsTable.set(child, eventParents = []);
    eventParents.push(insertionPoint);
  }

  function resetDistributedChildNodes(insertionPoint) {
    distributedChildNodesTable.set(insertionPoint, []);
  }

  function getDistributedChildNodes(insertionPoint) {
    var rv = distributedChildNodesTable.get(insertionPoint);
    if (!rv)
      distributedChildNodesTable.set(insertionPoint, rv = []);
    return rv;
  }

  function getChildNodesSnapshot(node) {
    var result = [], i = 0;
    for (var child = node.firstChild; child; child = child.nextSibling) {
      result[i++] = child;
    }
    return result;
  }

  /**
   * Visits all nodes in the tree that fulfils the |predicate|. If the |visitor|
   * function returns |false| the traversal is aborted.
   * @param {!Node} tree
   * @param {function(!Node) : boolean} predicate
   * @param {function(!Node) : *} visitor
   */
  function visit(tree, predicate, visitor) {
    // This operates on logical DOM.
    for (var node = tree.firstChild; node; node = node.nextSibling) {
      if (predicate(node)) {
        if (visitor(node) === false)
          return;
      } else {
        visit(node, predicate, visitor);
      }
    }
  }

  // Matching Insertion Points
  // http://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/shadow/index.html#matching-insertion-points

  // TODO(arv): Verify this... I don't remember why I picked this regexp.
  var selectorMatchRegExp = /^[*.:#[a-zA-Z_|]/;

  var allowedPseudoRegExp = new RegExp('^:(' + [
    'link',
    'visited',
    'target',
    'enabled',
    'disabled',
    'checked',
    'indeterminate',
    'nth-child',
    'nth-last-child',
    'nth-of-type',
    'nth-last-of-type',
    'first-child',
    'last-child',
    'first-of-type',
    'last-of-type',
    'only-of-type',
  ].join('|') + ')');


  /**
   * @param {Element} node
   * @oaram {Element} point The insertion point element.
   * @return {boolean} Whether the node matches the insertion point.
   */
  function matchesCriteria(node, point) {
    var select = point.getAttribute('select');
    if (!select)
      return true;

    // Here we know the select attribute is a non empty string.
    select = select.trim();
    if (!select)
      return true;

    if (!(node instanceof Element))
      return false;

    // The native matches function in IE9 does not correctly work with elements
    // that are not in the document.
    // TODO(arv): Implement matching in JS.
    // https://github.com/Polymer/ShadowDOM/issues/361
    if (select === '*' || select === node.localName)
      return true;

    // TODO(arv): This does not seem right. Need to check for a simple selector.
    if (!selectorMatchRegExp.test(select))
      return false;

    // TODO(arv): This no longer matches the spec.
    if (select[0] === ':' && !allowedPseudoRegExp.test(select))
      return false;

    try {
      return node.matches(select);
    } catch (ex) {
      // Invalid selector.
      return false;
    }
  }

  var request = oneOf(window, [
    'requestAnimationFrame',
    'mozRequestAnimationFrame',
    'webkitRequestAnimationFrame',
    'setTimeout'
  ]);

  var pendingDirtyRenderers = [];
  var renderTimer;

  function renderAllPending() {
    // TODO(arv): Order these in document order. That way we do not have to
    // render something twice.
    for (var i = 0; i < pendingDirtyRenderers.length; i++) {
      var renderer = pendingDirtyRenderers[i];
      var parentRenderer = renderer.parentRenderer;
      if (parentRenderer && parentRenderer.dirty)
        continue;
      renderer.render();
    }

    pendingDirtyRenderers = [];
  }

  function handleRequestAnimationFrame() {
    renderTimer = null;
    renderAllPending();
  }

  /**
   * Returns existing shadow renderer for a host or creates it if it is needed.
   * @params {!Element} host
   * @return {!ShadowRenderer}
   */
  function getRendererForHost(host) {
    var renderer = rendererForHostTable.get(host);
    if (!renderer) {
      renderer = new ShadowRenderer(host);
      rendererForHostTable.set(host, renderer);
    }
    return renderer;
  }

  function getShadowRootAncestor(node) {
    var root = getTreeScope(node).root;
    if (root instanceof ShadowRoot)
      return root;
    return null;
  }

  function getRendererForShadowRoot(shadowRoot) {
    return getRendererForHost(shadowRoot.host);
  }

  var spliceDiff = new ArraySplice();
  spliceDiff.equals = function(renderNode, rawNode) {
    return unwrap(renderNode.node) === rawNode;
  };

  /**
   * RenderNode is used as an in memory "render tree". When we render the
   * composed tree we create a tree of RenderNodes, then we diff this against
   * the real DOM tree and make minimal changes as needed.
   */
  function RenderNode(node) {
    this.skip = false;
    this.node = node;
    this.childNodes = [];
  }

  RenderNode.prototype = {
    append: function(node) {
      var rv = new RenderNode(node);
      this.childNodes.push(rv);
      return rv;
    },

    sync: function(opt_added) {
      if (this.skip)
        return;

      var nodeWrapper = this.node;
      // plain array of RenderNodes
      var newChildren = this.childNodes;
      // plain array of real nodes.
      var oldChildren = getChildNodesSnapshot(unwrap(nodeWrapper));
      var added = opt_added || new WeakMap();

      var splices = spliceDiff.calculateSplices(newChildren, oldChildren);

      var newIndex = 0, oldIndex = 0;
      var lastIndex = 0;
      for (var i = 0; i < splices.length; i++) {
        var splice = splices[i];
        for (; lastIndex < splice.index; lastIndex++) {
          oldIndex++;
          newChildren[newIndex++].sync(added);
        }

        var removedCount = splice.removed.length;
        for (var j = 0; j < removedCount; j++) {
          var wrapper = wrap(oldChildren[oldIndex++]);
          if (!added.get(wrapper))
            remove(wrapper);
        }

        var addedCount = splice.addedCount;
        var refNode = oldChildren[oldIndex] && wrap(oldChildren[oldIndex]);
        for (var j = 0; j < addedCount; j++) {
          var newChildRenderNode = newChildren[newIndex++];
          var newChildWrapper = newChildRenderNode.node;
          insertBefore(nodeWrapper, newChildWrapper, refNode);

          // Keep track of added so that we do not remove the node after it
          // has been added.
          added.set(newChildWrapper, true);

          newChildRenderNode.sync(added);
        }

        lastIndex += addedCount;
      }

      for (var i = lastIndex; i < newChildren.length; i++) {
        newChildren[i].sync(added);
      }
    }
  };

  function ShadowRenderer(host) {
    this.host = host;
    this.dirty = false;
    this.invalidateAttributes();
    this.associateNode(host);
  }

  ShadowRenderer.prototype = {

    // http://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/shadow/index.html#rendering-shadow-trees
    render: function(opt_renderNode) {
      if (!this.dirty)
        return;

      this.invalidateAttributes();
      this.treeComposition();

      var host = this.host;
      var shadowRoot = host.shadowRoot;

      this.associateNode(host);
      var topMostRenderer = !renderNode;
      var renderNode = opt_renderNode || new RenderNode(host);

      for (var node = shadowRoot.firstChild; node; node = node.nextSibling) {
        this.renderNode(shadowRoot, renderNode, node, false);
      }

      if (topMostRenderer)
        renderNode.sync();

      this.dirty = false;
    },

    get parentRenderer() {
      return getTreeScope(this.host).renderer;
    },

    invalidate: function() {
      if (!this.dirty) {
        this.dirty = true;
        pendingDirtyRenderers.push(this);
        if (renderTimer)
          return;
        renderTimer = window[request](handleRequestAnimationFrame, 0);
      }
    },

    renderNode: function(shadowRoot, renderNode, node, isNested) {
      if (isShadowHost(node)) {
        renderNode = renderNode.append(node);
        var renderer = getRendererForHost(node);
        renderer.dirty = true;  // Need to rerender due to reprojection.
        renderer.render(renderNode);
      } else if (isInsertionPoint(node)) {
        this.renderInsertionPoint(shadowRoot, renderNode, node, isNested);
      } else if (isShadowInsertionPoint(node)) {
        this.renderShadowInsertionPoint(shadowRoot, renderNode, node);
      } else {
        this.renderAsAnyDomTree(shadowRoot, renderNode, node, isNested);
      }
    },

    renderAsAnyDomTree: function(shadowRoot, renderNode, node, isNested) {
      renderNode = renderNode.append(node);

      if (isShadowHost(node)) {
        var renderer = getRendererForHost(node);
        renderNode.skip = !renderer.dirty;
        renderer.render(renderNode);
      } else {
        for (var child = node.firstChild; child; child = child.nextSibling) {
          this.renderNode(shadowRoot, renderNode, child, isNested);
        }
      }
    },

    renderInsertionPoint: function(shadowRoot, renderNode, insertionPoint,
                                   isNested) {
      var distributedChildNodes = getDistributedChildNodes(insertionPoint);
      if (distributedChildNodes.length) {
        this.associateNode(insertionPoint);

        for (var i = 0; i < distributedChildNodes.length; i++) {
          var child = distributedChildNodes[i];
          if (isInsertionPoint(child) && isNested)
            this.renderInsertionPoint(shadowRoot, renderNode, child, isNested);
          else
            this.renderAsAnyDomTree(shadowRoot, renderNode, child, isNested);
        }
      } else {
        this.renderFallbackContent(shadowRoot, renderNode, insertionPoint);
      }
      this.associateNode(insertionPoint.parentNode);
    },

    renderShadowInsertionPoint: function(shadowRoot, renderNode,
                                         shadowInsertionPoint) {
      var nextOlderTree = shadowRoot.olderShadowRoot;
      if (nextOlderTree) {
        assignToInsertionPoint(nextOlderTree, shadowInsertionPoint);
        this.associateNode(shadowInsertionPoint.parentNode);
        for (var node = nextOlderTree.firstChild;
             node;
             node = node.nextSibling) {
          this.renderNode(nextOlderTree, renderNode, node, true);
        }
      } else {
        this.renderFallbackContent(shadowRoot, renderNode,
                                   shadowInsertionPoint);
      }
    },

    renderFallbackContent: function(shadowRoot, renderNode, fallbackHost) {
      this.associateNode(fallbackHost);
      this.associateNode(fallbackHost.parentNode);
      for (var node = fallbackHost.firstChild; node; node = node.nextSibling) {
        this.renderAsAnyDomTree(shadowRoot, renderNode, node, false);
      }
    },

    /**
     * Invalidates the attributes used to keep track of which attributes may
     * cause the renderer to be invalidated.
     */
    invalidateAttributes: function() {
      this.attributes = Object.create(null);
    },

    /**
     * Parses the selector and makes this renderer dependent on the attribute
     * being used in the selector.
     * @param {string} selector
     */
    updateDependentAttributes: function(selector) {
      if (!selector)
        return;

      var attributes = this.attributes;

      // .class
      if (/\.\w+/.test(selector))
        attributes['class'] = true;

      // #id
      if (/#\w+/.test(selector))
        attributes['id'] = true;

      selector.replace(/\[\s*([^\s=\|~\]]+)/g, function(_, name) {
        attributes[name] = true;
      });

      // Pseudo selectors have been removed from the spec.
    },

    dependsOnAttribute: function(name) {
      return this.attributes[name];
    },

    // http://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/shadow/index.html#dfn-distribution-algorithm
    distribute: function(tree, pool) {
      var self = this;

      visit(tree, isActiveInsertionPoint,
          function(insertionPoint) {
            resetDistributedChildNodes(insertionPoint);
            self.updateDependentAttributes(
                insertionPoint.getAttribute('select'));

            for (var i = 0; i < pool.length; i++) {  // 1.2
              var node = pool[i];  // 1.2.1
              if (node === undefined)  // removed
                continue;
              if (matchesCriteria(node, insertionPoint)) {  // 1.2.2
                distributeChildToInsertionPoint(node, insertionPoint);  // 1.2.2.1
                pool[i] = undefined;  // 1.2.2.2
              }
            }
          });
    },

    // http://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/shadow/index.html#dfn-tree-composition
    treeComposition: function () {
      var shadowHost = this.host;
      var tree = shadowHost.shadowRoot;  // 1.
      var pool = [];  // 2.

      for (var child = shadowHost.firstChild;
           child;
           child = child.nextSibling) {  // 3.
        if (isInsertionPoint(child)) {  // 3.2.
          var reprojected = getDistributedChildNodes(child);  // 3.2.1.
          // if reprojected is undef... reset it?
          if (!reprojected || !reprojected.length)  // 3.2.2.
            reprojected = getChildNodesSnapshot(child);
          pool.push.apply(pool, reprojected);  // 3.2.3.
        } else {
          pool.push(child); // 3.3.
        }
      }

      var shadowInsertionPoint, point;
      while (tree) {  // 4.
        // 4.1.
        shadowInsertionPoint = undefined;  // Reset every iteration.
        visit(tree, isActiveShadowInsertionPoint, function(point) {
          shadowInsertionPoint = point;
          return false;
        });
        point = shadowInsertionPoint;

        this.distribute(tree, pool);  // 4.2.
        if (point) {  // 4.3.
          var nextOlderTree = tree.olderShadowRoot;  // 4.3.1.
          if (!nextOlderTree) {
            break;  // 4.3.1.1.
          } else {
            tree = nextOlderTree;  // 4.3.2.2.
            assignToInsertionPoint(tree, point);  // 4.3.2.2.
            continue;  // 4.3.2.3.
          }
        } else {
          break;  // 4.4.
        }
      }
    },

    associateNode: function(node) {
      node.impl.polymerShadowRenderer_ = this;
    }
  };

  function isInsertionPoint(node) {
    // Should this include <shadow>?
    return node instanceof HTMLContentElement;
  }

  function isActiveInsertionPoint(node) {
    // <content> inside another <content> or <shadow> is considered inactive.
    return node instanceof HTMLContentElement;
  }

  function isShadowInsertionPoint(node) {
    return node instanceof HTMLShadowElement;
  }

  function isActiveShadowInsertionPoint(node) {
    // <shadow> inside another <content> or <shadow> is considered inactive.
    return node instanceof HTMLShadowElement;
  }

  function isShadowHost(shadowHost) {
    return shadowHost.shadowRoot;
  }

  function getShadowTrees(host) {
    var trees = [];

    for (var tree = host.shadowRoot; tree; tree = tree.olderShadowRoot) {
      trees.push(tree);
    }
    return trees;
  }

  function assignToInsertionPoint(tree, point) {
    insertionParentTable.set(tree, point);
  }

  // http://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/shadow/index.html#rendering-shadow-trees
  function render(host) {
    new ShadowRenderer(host).render();
  };

  // Need to rerender shadow host when:
  //
  // - a direct child to the ShadowRoot is added or removed
  // - a direct child to the host is added or removed
  // - a new shadow root is created
  // - a direct child to a content/shadow element is added or removed
  // - a sibling to a content/shadow element is added or removed
  // - content[select] is changed
  // - an attribute in a direct child to a host is modified

  /**
   * This gets called when a node was added or removed to it.
   */
  Node.prototype.invalidateShadowRenderer = function(force) {
    var renderer = this.impl.polymerShadowRenderer_;
    if (renderer) {
      renderer.invalidate();
      return true;
    }

    return false;
  };

  HTMLContentElement.prototype.getDistributedNodes = function() {
    // TODO(arv): We should only rerender the dirty ancestor renderers (from
    // the root and down).
    renderAllPending();
    return getDistributedChildNodes(this);
  };

  HTMLShadowElement.prototype.nodeIsInserted_ =
  HTMLContentElement.prototype.nodeIsInserted_ = function() {
    // Invalidate old renderer if any.
    this.invalidateShadowRenderer();

    var shadowRoot = getShadowRootAncestor(this);
    var renderer;
    if (shadowRoot)
      renderer = getRendererForShadowRoot(shadowRoot);
    this.impl.polymerShadowRenderer_ = renderer;
    if (renderer)
      renderer.invalidate();
  };

  scope.eventParentsTable = eventParentsTable;
  scope.getRendererForHost = getRendererForHost;
  scope.getShadowTrees = getShadowTrees;
  scope.insertionParentTable = insertionParentTable;
  scope.renderAllPending = renderAllPending;

  // Exposed for testing
  scope.visual = {
    insertBefore: insertBefore,
    remove: remove,
  };

})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var HTMLElement = scope.wrappers.HTMLElement;
  var assert = scope.assert;
  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;
  var unwrap = scope.unwrap;
  var wrap = scope.wrap;

  var elementsWithFormProperty = [
    'HTMLButtonElement',
    'HTMLFieldSetElement',
    'HTMLInputElement',
    'HTMLKeygenElement',
    'HTMLLabelElement',
    'HTMLLegendElement',
    'HTMLObjectElement',
    // HTMLOptionElement is handled in HTMLOptionElement.js
    'HTMLOutputElement',
    // HTMLSelectElement is handled in HTMLSelectElement.js
    'HTMLTextAreaElement',
  ];

  function createWrapperConstructor(name) {
    if (!window[name])
      return;

    // Ensure we are not overriding an already existing constructor.
    assert(!scope.wrappers[name]);

    var GeneratedWrapper = function(node) {
      // At this point all of them extend HTMLElement.
      HTMLElement.call(this, node);
    }
    GeneratedWrapper.prototype = Object.create(HTMLElement.prototype);
    mixin(GeneratedWrapper.prototype, {
      get form() {
        return wrap(unwrap(this).form);
      },
    });

    registerWrapper(window[name], GeneratedWrapper,
        document.createElement(name.slice(4, -7)));
    scope.wrappers[name] = GeneratedWrapper;
  }

  elementsWithFormProperty.forEach(createWrapperConstructor);

})(window.ShadowDOMPolyfill);

// Copyright 2014 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var registerWrapper = scope.registerWrapper;
  var unwrap = scope.unwrap;
  var unwrapIfNeeded = scope.unwrapIfNeeded;
  var wrap = scope.wrap;

  var OriginalSelection = window.Selection;

  function Selection(impl) {
    this.impl = impl;
  }
  Selection.prototype = {
    get anchorNode() {
      return wrap(this.impl.anchorNode);
    },
    get focusNode() {
      return wrap(this.impl.focusNode);
    },
    addRange: function(range) {
      this.impl.addRange(unwrap(range));
    },
    collapse: function(node, index) {
      this.impl.collapse(unwrapIfNeeded(node), index);
    },
    containsNode: function(node, allowPartial) {
      return this.impl.containsNode(unwrapIfNeeded(node), allowPartial);
    },
    extend: function(node, offset) {
      this.impl.extend(unwrapIfNeeded(node), offset);
    },
    getRangeAt: function(index) {
      return wrap(this.impl.getRangeAt(index));
    },
    removeRange: function(range) {
      this.impl.removeRange(unwrap(range));
    },
    selectAllChildren: function(node) {
      this.impl.selectAllChildren(unwrapIfNeeded(node));
    },
    toString: function() {
      return this.impl.toString();
    }
  };

  // WebKit extensions. Not implemented.
  // readonly attribute Node baseNode;
  // readonly attribute long baseOffset;
  // readonly attribute Node extentNode;
  // readonly attribute long extentOffset;
  // [RaisesException] void setBaseAndExtent([Default=Undefined] optional Node baseNode,
  //                       [Default=Undefined] optional long baseOffset,
  //                       [Default=Undefined] optional Node extentNode,
  //                       [Default=Undefined] optional long extentOffset);
  // [RaisesException, ImplementedAs=collapse] void setPosition([Default=Undefined] optional Node node,
  //                  [Default=Undefined] optional long offset);

  registerWrapper(window.Selection, Selection, window.getSelection());

  scope.wrappers.Selection = Selection;

})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var GetElementsByInterface = scope.GetElementsByInterface;
  var Node = scope.wrappers.Node;
  var ParentNodeInterface = scope.ParentNodeInterface;
  var Selection = scope.wrappers.Selection;
  var SelectorsInterface = scope.SelectorsInterface;
  var ShadowRoot = scope.wrappers.ShadowRoot;
  var TreeScope = scope.TreeScope;
  var cloneNode = scope.cloneNode;
  var defineWrapGetter = scope.defineWrapGetter;
  var elementFromPoint = scope.elementFromPoint;
  var forwardMethodsToWrapper = scope.forwardMethodsToWrapper;
  var matchesNames = scope.matchesNames;
  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;
  var renderAllPending = scope.renderAllPending;
  var rewrap = scope.rewrap;
  var unwrap = scope.unwrap;
  var wrap = scope.wrap;
  var wrapEventTargetMethods = scope.wrapEventTargetMethods;
  var wrapNodeList = scope.wrapNodeList;

  var implementationTable = new WeakMap();

  function Document(node) {
    Node.call(this, node);
    this.treeScope_ = new TreeScope(this, null);
  }
  Document.prototype = Object.create(Node.prototype);

  defineWrapGetter(Document, 'documentElement');

  // Conceptually both body and head can be in a shadow but suporting that seems
  // overkill at this point.
  defineWrapGetter(Document, 'body');
  defineWrapGetter(Document, 'head');

  // document cannot be overridden so we override a bunch of its methods
  // directly on the instance.

  function wrapMethod(name) {
    var original = document[name];
    Document.prototype[name] = function() {
      return wrap(original.apply(this.impl, arguments));
    };
  }

  [
    'createComment',
    'createDocumentFragment',
    'createElement',
    'createElementNS',
    'createEvent',
    'createEventNS',
    'createRange',
    'createTextNode',
    'getElementById'
  ].forEach(wrapMethod);

  var originalAdoptNode = document.adoptNode;

  function adoptNodeNoRemove(node, doc) {
    originalAdoptNode.call(doc.impl, unwrap(node));
    adoptSubtree(node, doc);
  }

  function adoptSubtree(node, doc) {
    if (node.shadowRoot)
      doc.adoptNode(node.shadowRoot);
    if (node instanceof ShadowRoot)
      adoptOlderShadowRoots(node, doc);
    for (var child = node.firstChild; child; child = child.nextSibling) {
      adoptSubtree(child, doc);
    }
  }

  function adoptOlderShadowRoots(shadowRoot, doc) {
    var oldShadowRoot = shadowRoot.olderShadowRoot;
    if (oldShadowRoot)
      doc.adoptNode(oldShadowRoot);
  }

  var originalGetSelection = document.getSelection;

  mixin(Document.prototype, {
    adoptNode: function(node) {
      if (node.parentNode)
        node.parentNode.removeChild(node);
      adoptNodeNoRemove(node, this);
      return node;
    },
    elementFromPoint: function(x, y) {
      return elementFromPoint(this, this, x, y);
    },
    importNode: function(node, deep) {
      return cloneNode(node, deep, this.impl);
    },
    getSelection: function() {
      renderAllPending();
      return new Selection(originalGetSelection.call(unwrap(this)));
    }
  });

  if (document.registerElement) {
    var originalRegisterElement = document.registerElement;
    Document.prototype.registerElement = function(tagName, object) {
      var prototype, extendsOption;
      if (object !== undefined) {
        prototype = object.prototype;
        extendsOption = object.extends;
      }

      if (!prototype)
        prototype = Object.create(HTMLElement.prototype);


      // If we already used the object as a prototype for another custom
      // element.
      if (scope.nativePrototypeTable.get(prototype)) {
        // TODO(arv): DOMException
        throw new Error('NotSupportedError');
      }

      // Find first object on the prototype chain that already have a native
      // prototype. Keep track of all the objects before that so we can create
      // a similar structure for the native case.
      var proto = Object.getPrototypeOf(prototype);
      var nativePrototype;
      var prototypes = [];
      while (proto) {
        nativePrototype = scope.nativePrototypeTable.get(proto);
        if (nativePrototype)
          break;
        prototypes.push(proto);
        proto = Object.getPrototypeOf(proto);
      }

      if (!nativePrototype) {
        // TODO(arv): DOMException
        throw new Error('NotSupportedError');
      }

      // This works by creating a new prototype object that is empty, but has
      // the native prototype as its proto. The original prototype object
      // passed into register is used as the wrapper prototype.

      var newPrototype = Object.create(nativePrototype);
      for (var i = prototypes.length - 1; i >= 0; i--) {
        newPrototype = Object.create(newPrototype);
      }

      // Add callbacks if present.
      // Names are taken from:
      //   https://code.google.com/p/chromium/codesearch#chromium/src/third_party/WebKit/Source/bindings/v8/CustomElementConstructorBuilder.cpp&sq=package:chromium&type=cs&l=156
      // and not from the spec since the spec is out of date.
      [
        'createdCallback',
        'attachedCallback',
        'detachedCallback',
        'attributeChangedCallback',
      ].forEach(function(name) {
        var f = prototype[name];
        if (!f)
          return;
        newPrototype[name] = function() {
          // if this element has been wrapped prior to registration,
          // the wrapper is stale; in this case rewrap
          if (!(wrap(this) instanceof CustomElementConstructor)) {
            rewrap(this);
          }
          f.apply(wrap(this), arguments);
        };
      });

      var p = {prototype: newPrototype};
      if (extendsOption)
        p.extends = extendsOption;

      function CustomElementConstructor(node) {
        if (!node) {
          if (extendsOption) {
            return document.createElement(extendsOption, tagName);
          } else {
            return document.createElement(tagName);
          }
        }
        this.impl = node;
      }
      CustomElementConstructor.prototype = prototype;
      CustomElementConstructor.prototype.constructor = CustomElementConstructor;

      scope.constructorTable.set(newPrototype, CustomElementConstructor);
      scope.nativePrototypeTable.set(prototype, newPrototype);

      // registration is synchronous so do it last
      var nativeConstructor = originalRegisterElement.call(unwrap(this),
          tagName, p);
      return CustomElementConstructor;
    };

    forwardMethodsToWrapper([
      window.HTMLDocument || window.Document,  // Gecko adds these to HTMLDocument
    ], [
      'registerElement',
    ]);
  }

  // We also override some of the methods on document.body and document.head
  // for convenience.
  forwardMethodsToWrapper([
    window.HTMLBodyElement,
    window.HTMLDocument || window.Document,  // Gecko adds these to HTMLDocument
    window.HTMLHeadElement,
    window.HTMLHtmlElement,
  ], [
    'appendChild',
    'compareDocumentPosition',
    'contains',
    'getElementsByClassName',
    'getElementsByTagName',
    'getElementsByTagNameNS',
    'insertBefore',
    'querySelector',
    'querySelectorAll',
    'removeChild',
    'replaceChild',
  ].concat(matchesNames));

  forwardMethodsToWrapper([
    window.HTMLDocument || window.Document,  // Gecko adds these to HTMLDocument
  ], [
    'adoptNode',
    'importNode',
    'contains',
    'createComment',
    'createDocumentFragment',
    'createElement',
    'createElementNS',
    'createEvent',
    'createEventNS',
    'createRange',
    'createTextNode',
    'elementFromPoint',
    'getElementById',
    'getSelection',
  ]);

  mixin(Document.prototype, GetElementsByInterface);
  mixin(Document.prototype, ParentNodeInterface);
  mixin(Document.prototype, SelectorsInterface);

  mixin(Document.prototype, {
    get implementation() {
      var implementation = implementationTable.get(this);
      if (implementation)
        return implementation;
      implementation =
          new DOMImplementation(unwrap(this).implementation);
      implementationTable.set(this, implementation);
      return implementation;
    }
  });

  registerWrapper(window.Document, Document,
      document.implementation.createHTMLDocument(''));

  // Both WebKit and Gecko uses HTMLDocument for document. HTML5/DOM only has
  // one Document interface and IE implements the standard correctly.
  if (window.HTMLDocument)
    registerWrapper(window.HTMLDocument, Document);

  wrapEventTargetMethods([
    window.HTMLBodyElement,
    window.HTMLDocument || window.Document,  // Gecko adds these to HTMLDocument
    window.HTMLHeadElement,
  ]);

  function DOMImplementation(impl) {
    this.impl = impl;
  }

  function wrapImplMethod(constructor, name) {
    var original = document.implementation[name];
    constructor.prototype[name] = function() {
      return wrap(original.apply(this.impl, arguments));
    };
  }

  function forwardImplMethod(constructor, name) {
    var original = document.implementation[name];
    constructor.prototype[name] = function() {
      return original.apply(this.impl, arguments);
    };
  }

  wrapImplMethod(DOMImplementation, 'createDocumentType');
  wrapImplMethod(DOMImplementation, 'createDocument');
  wrapImplMethod(DOMImplementation, 'createHTMLDocument');
  forwardImplMethod(DOMImplementation, 'hasFeature');

  registerWrapper(window.DOMImplementation, DOMImplementation);

  forwardMethodsToWrapper([
    window.DOMImplementation,
  ], [
    'createDocumentType',
    'createDocument',
    'createHTMLDocument',
    'hasFeature',
  ]);

  scope.adoptNodeNoRemove = adoptNodeNoRemove;
  scope.wrappers.DOMImplementation = DOMImplementation;
  scope.wrappers.Document = Document;

})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var EventTarget = scope.wrappers.EventTarget;
  var Selection = scope.wrappers.Selection;
  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;
  var renderAllPending = scope.renderAllPending;
  var unwrap = scope.unwrap;
  var unwrapIfNeeded = scope.unwrapIfNeeded;
  var wrap = scope.wrap;

  var OriginalWindow = window.Window;
  var originalGetComputedStyle = window.getComputedStyle;
  var originalGetSelection = window.getSelection;

  function Window(impl) {
    EventTarget.call(this, impl);
  }
  Window.prototype = Object.create(EventTarget.prototype);

  OriginalWindow.prototype.getComputedStyle = function(el, pseudo) {
    return wrap(this || window).getComputedStyle(unwrapIfNeeded(el), pseudo);
  };

  OriginalWindow.prototype.getSelection = function() {
    return wrap(this || window).getSelection();
  };

  // Work around for https://bugzilla.mozilla.org/show_bug.cgi?id=943065
  delete window.getComputedStyle;
  delete window.getSelection;

  ['addEventListener', 'removeEventListener', 'dispatchEvent'].forEach(
      function(name) {
        OriginalWindow.prototype[name] = function() {
          var w = wrap(this || window);
          return w[name].apply(w, arguments);
        };

        // Work around for https://bugzilla.mozilla.org/show_bug.cgi?id=943065
        delete window[name];
      });

  mixin(Window.prototype, {
    getComputedStyle: function(el, pseudo) {
      renderAllPending();
      return originalGetComputedStyle.call(unwrap(this), unwrapIfNeeded(el),
                                           pseudo);
    },
    getSelection: function() {
      renderAllPending();
      return new Selection(originalGetSelection.call(unwrap(this)));
    },
  });

  registerWrapper(OriginalWindow, Window);

  scope.wrappers.Window = Window;

})(window.ShadowDOMPolyfill);

/**
 * Copyright 2014 The Polymer Authors. All rights reserved.
 * Use of this source code is goverened by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(scope) {
  'use strict';

  var unwrap = scope.unwrap;

  // DataTransfer (Clipboard in old Blink/WebKit) has a single method that
  // requires wrapping. Since it is only a method we do not need a real wrapper,
  // we can just override the method.

  var OriginalDataTransfer = window.DataTransfer || window.Clipboard;
  var OriginalDataTransferSetDragImage =
      OriginalDataTransfer.prototype.setDragImage;

  OriginalDataTransfer.prototype.setDragImage = function(image, x, y) {
    OriginalDataTransferSetDragImage.call(this, unwrap(image), x, y);
  };

})(window.ShadowDOMPolyfill);

// Copyright 2013 The Polymer Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var isWrapperFor = scope.isWrapperFor;

  // This is a list of the elements we currently override the global constructor
  // for.
  var elements = {
    'a': 'HTMLAnchorElement',
    // Do not create an applet element by default since it shows a warning in
    // IE.
    // https://github.com/Polymer/polymer/issues/217
    // 'applet': 'HTMLAppletElement',
    'area': 'HTMLAreaElement',
    'audio': 'HTMLAudioElement',
    'base': 'HTMLBaseElement',
    'body': 'HTMLBodyElement',
    'br': 'HTMLBRElement',
    'button': 'HTMLButtonElement',
    'canvas': 'HTMLCanvasElement',
    'caption': 'HTMLTableCaptionElement',
    'col': 'HTMLTableColElement',
    // 'command': 'HTMLCommandElement',  // Not fully implemented in Gecko.
    'content': 'HTMLContentElement',
    'data': 'HTMLDataElement',
    'datalist': 'HTMLDataListElement',
    'del': 'HTMLModElement',
    'dir': 'HTMLDirectoryElement',
    'div': 'HTMLDivElement',
    'dl': 'HTMLDListElement',
    'embed': 'HTMLEmbedElement',
    'fieldset': 'HTMLFieldSetElement',
    'font': 'HTMLFontElement',
    'form': 'HTMLFormElement',
    'frame': 'HTMLFrameElement',
    'frameset': 'HTMLFrameSetElement',
    'h1': 'HTMLHeadingElement',
    'head': 'HTMLHeadElement',
    'hr': 'HTMLHRElement',
    'html': 'HTMLHtmlElement',
    'iframe': 'HTMLIFrameElement',
    'img': 'HTMLImageElement',
    'input': 'HTMLInputElement',
    'keygen': 'HTMLKeygenElement',
    'label': 'HTMLLabelElement',
    'legend': 'HTMLLegendElement',
    'li': 'HTMLLIElement',
    'link': 'HTMLLinkElement',
    'map': 'HTMLMapElement',
    'marquee': 'HTMLMarqueeElement',
    'menu': 'HTMLMenuElement',
    'menuitem': 'HTMLMenuItemElement',
    'meta': 'HTMLMetaElement',
    'meter': 'HTMLMeterElement',
    'object': 'HTMLObjectElement',
    'ol': 'HTMLOListElement',
    'optgroup': 'HTMLOptGroupElement',
    'option': 'HTMLOptionElement',
    'output': 'HTMLOutputElement',
    'p': 'HTMLParagraphElement',
    'param': 'HTMLParamElement',
    'pre': 'HTMLPreElement',
    'progress': 'HTMLProgressElement',
    'q': 'HTMLQuoteElement',
    'script': 'HTMLScriptElement',
    'select': 'HTMLSelectElement',
    'shadow': 'HTMLShadowElement',
    'source': 'HTMLSourceElement',
    'span': 'HTMLSpanElement',
    'style': 'HTMLStyleElement',
    'table': 'HTMLTableElement',
    'tbody': 'HTMLTableSectionElement',
    // WebKit and Moz are wrong:
    // https://bugs.webkit.org/show_bug.cgi?id=111469
    // https://bugzilla.mozilla.org/show_bug.cgi?id=848096
    // 'td': 'HTMLTableCellElement',
    'template': 'HTMLTemplateElement',
    'textarea': 'HTMLTextAreaElement',
    'thead': 'HTMLTableSectionElement',
    'time': 'HTMLTimeElement',
    'title': 'HTMLTitleElement',
    'tr': 'HTMLTableRowElement',
    'track': 'HTMLTrackElement',
    'ul': 'HTMLUListElement',
    'video': 'HTMLVideoElement',
  };

  function overrideConstructor(tagName) {
    var nativeConstructorName = elements[tagName];
    var nativeConstructor = window[nativeConstructorName];
    if (!nativeConstructor)
      return;
    var element = document.createElement(tagName);
    var wrapperConstructor = element.constructor;
    window[nativeConstructorName] = wrapperConstructor;
  }

  Object.keys(elements).forEach(overrideConstructor);

  Object.getOwnPropertyNames(scope.wrappers).forEach(function(name) {
    window[name] = scope.wrappers[name]
  });

})(window.ShadowDOMPolyfill);

// We don't use the platform bootstrapper, so fake this stuff.

window.Platform = {};
var logFlags = {};


// DOMTokenList polyfill for IE9
(function () {

if (typeof window.Element === "undefined" || "classList" in document.documentElement) return;

var prototype = Array.prototype,
    indexOf = prototype.indexOf,
    slice = prototype.slice,
    push = prototype.push,
    splice = prototype.splice,
    join = prototype.join;

function DOMTokenList(el) {
  this._element = el;
  if (el.className != this._classCache) {
    this._classCache = el.className;

    if (!this._classCache) return;

      // The className needs to be trimmed and split on whitespace
      // to retrieve a list of classes.
      var classes = this._classCache.replace(/^\s+|\s+$/g,'').split(/\s+/),
        i;
    for (i = 0; i < classes.length; i++) {
      push.call(this, classes[i]);
    }
  }
};

function setToClassName(el, classes) {
  el.className = classes.join(' ');
}

DOMTokenList.prototype = {
  add: function(token) {
    if(this.contains(token)) return;
    push.call(this, token);
    setToClassName(this._element, slice.call(this, 0));
  },
  contains: function(token) {
    return indexOf.call(this, token) !== -1;
  },
  item: function(index) {
    return this[index] || null;
  },
  remove: function(token) {
    var i = indexOf.call(this, token);
     if (i === -1) {
       return;
     }
    splice.call(this, i, 1);
    setToClassName(this._element, slice.call(this, 0));
  },
  toString: function() {
    return join.call(this, ' ');
  },
  toggle: function(token) {
    if (indexOf.call(this, token) === -1) {
      this.add(token);
    } else {
      this.remove(token);
    }
  }
};

window.DOMTokenList = DOMTokenList;

function defineElementGetter (obj, prop, getter) {
  if (Object.defineProperty) {
    Object.defineProperty(obj, prop,{
      get : getter
    })
  } else {
    obj.__defineGetter__(prop, getter);
  }
}

defineElementGetter(Element.prototype, 'classList', function () {
  return new DOMTokenList(this);
});

})();


/*
 * Copyright 2012 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

if (typeof WeakMap === 'undefined') {
  (function() {
    var defineProperty = Object.defineProperty;
    var counter = Date.now() % 1e9;

    var WeakMap = function() {
      this.name = '__st' + (Math.random() * 1e9 >>> 0) + (counter++ + '__');
    };

    WeakMap.prototype = {
      set: function(key, value) {
        var entry = key[this.name];
        if (entry && entry[0] === key)
          entry[1] = value;
        else
          defineProperty(key, this.name, {value: [key, value], writable: true});
      },
      get: function(key) {
        var entry;
        return (entry = key[this.name]) && entry[0] === key ?
            entry[1] : undefined;
      },
      delete: function(key) {
        this.set(key, undefined);
      }
    };

    window.WeakMap = WeakMap;
  })();
}

/*
 * Copyright 2012 The Polymer Authors. All rights reserved.
 * Use of this source code is goverened by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(global) {

  var registrationsTable = new WeakMap();

  // We use setImmediate or postMessage for our future callback.
  var setImmediate = window.msSetImmediate;

  // Use post message to emulate setImmediate.
  if (!setImmediate) {
    var setImmediateQueue = [];
    var sentinel = String(Math.random());
    window.addEventListener('message', function(e) {
      if (e.data === sentinel) {
        var queue = setImmediateQueue;
        setImmediateQueue = [];
        queue.forEach(function(func) {
          func();
        });
      }
    });
    setImmediate = function(func) {
      setImmediateQueue.push(func);
      window.postMessage(sentinel, '*');
    };
  }

  // This is used to ensure that we never schedule 2 callas to setImmediate
  var isScheduled = false;

  // Keep track of observers that needs to be notified next time.
  var scheduledObservers = [];

  /**
   * Schedules |dispatchCallback| to be called in the future.
   * @param {MutationObserver} observer
   */
  function scheduleCallback(observer) {
    scheduledObservers.push(observer);
    if (!isScheduled) {
      isScheduled = true;
      setImmediate(dispatchCallbacks);
    }
  }

  function wrapIfNeeded(node) {
    return window.ShadowDOMPolyfill &&
        window.ShadowDOMPolyfill.wrapIfNeeded(node) ||
        node;
  }

  function dispatchCallbacks() {
    // http://dom.spec.whatwg.org/#mutation-observers

    isScheduled = false; // Used to allow a new setImmediate call above.

    var observers = scheduledObservers;
    scheduledObservers = [];
    // Sort observers based on their creation UID (incremental).
    observers.sort(function(o1, o2) {
      return o1.uid_ - o2.uid_;
    });

    var anyNonEmpty = false;
    observers.forEach(function(observer) {

      // 2.1, 2.2
      var queue = observer.takeRecords();
      // 2.3. Remove all transient registered observers whose observer is mo.
      removeTransientObserversFor(observer);

      // 2.4
      if (queue.length) {
        observer.callback_(queue, observer);
        anyNonEmpty = true;
      }
    });

    // 3.
    if (anyNonEmpty)
      dispatchCallbacks();
  }

  function removeTransientObserversFor(observer) {
    observer.nodes_.forEach(function(node) {
      var registrations = registrationsTable.get(node);
      if (!registrations)
        return;
      registrations.forEach(function(registration) {
        if (registration.observer === observer)
          registration.removeTransientObservers();
      });
    });
  }

  /**
   * This function is used for the "For each registered observer observer (with
   * observer's options as options) in target's list of registered observers,
   * run these substeps:" and the "For each ancestor ancestor of target, and for
   * each registered observer observer (with options options) in ancestor's list
   * of registered observers, run these substeps:" part of the algorithms. The
   * |options.subtree| is checked to ensure that the callback is called
   * correctly.
   *
   * @param {Node} target
   * @param {function(MutationObserverInit):MutationRecord} callback
   */
  function forEachAncestorAndObserverEnqueueRecord(target, callback) {
    for (var node = target; node; node = node.parentNode) {
      var registrations = registrationsTable.get(node);

      if (registrations) {
        for (var j = 0; j < registrations.length; j++) {
          var registration = registrations[j];
          var options = registration.options;

          // Only target ignores subtree.
          if (node !== target && !options.subtree)
            continue;

          var record = callback(options);
          if (record)
            registration.enqueue(record);
        }
      }
    }
  }

  var uidCounter = 0;

  /**
   * The class that maps to the DOM MutationObserver interface.
   * @param {Function} callback.
   * @constructor
   */
  function JsMutationObserver(callback) {
    this.callback_ = callback;
    this.nodes_ = [];
    this.records_ = [];
    this.uid_ = ++uidCounter;
  }

  JsMutationObserver.prototype = {
    observe: function(target, options) {
      target = wrapIfNeeded(target);

      // 1.1
      if (!options.childList && !options.attributes && !options.characterData ||

          // 1.2
          options.attributeOldValue && !options.attributes ||

          // 1.3
          options.attributeFilter && options.attributeFilter.length &&
              !options.attributes ||

          // 1.4
          options.characterDataOldValue && !options.characterData) {

        throw new SyntaxError();
      }

      var registrations = registrationsTable.get(target);
      if (!registrations)
        registrationsTable.set(target, registrations = []);

      // 2
      // If target's list of registered observers already includes a registered
      // observer associated with the context object, replace that registered
      // observer's options with options.
      var registration;
      for (var i = 0; i < registrations.length; i++) {
        if (registrations[i].observer === this) {
          registration = registrations[i];
          registration.removeListeners();
          registration.options = options;
          break;
        }
      }

      // 3.
      // Otherwise, add a new registered observer to target's list of registered
      // observers with the context object as the observer and options as the
      // options, and add target to context object's list of nodes on which it
      // is registered.
      if (!registration) {
        registration = new Registration(this, target, options);
        registrations.push(registration);
        this.nodes_.push(target);
      }

      registration.addListeners();
    },

    disconnect: function() {
      this.nodes_.forEach(function(node) {
        var registrations = registrationsTable.get(node);
        for (var i = 0; i < registrations.length; i++) {
          var registration = registrations[i];
          if (registration.observer === this) {
            registration.removeListeners();
            registrations.splice(i, 1);
            // Each node can only have one registered observer associated with
            // this observer.
            break;
          }
        }
      }, this);
      this.records_ = [];
    },

    takeRecords: function() {
      var copyOfRecords = this.records_;
      this.records_ = [];
      return copyOfRecords;
    }
  };

  /**
   * @param {string} type
   * @param {Node} target
   * @constructor
   */
  function MutationRecord(type, target) {
    this.type = type;
    this.target = target;
    this.addedNodes = [];
    this.removedNodes = [];
    this.previousSibling = null;
    this.nextSibling = null;
    this.attributeName = null;
    this.attributeNamespace = null;
    this.oldValue = null;
  }

  function copyMutationRecord(original) {
    var record = new MutationRecord(original.type, original.target);
    record.addedNodes = original.addedNodes.slice();
    record.removedNodes = original.removedNodes.slice();
    record.previousSibling = original.previousSibling;
    record.nextSibling = original.nextSibling;
    record.attributeName = original.attributeName;
    record.attributeNamespace = original.attributeNamespace;
    record.oldValue = original.oldValue;
    return record;
  };

  // We keep track of the two (possibly one) records used in a single mutation.
  var currentRecord, recordWithOldValue;

  /**
   * Creates a record without |oldValue| and caches it as |currentRecord| for
   * later use.
   * @param {string} oldValue
   * @return {MutationRecord}
   */
  function getRecord(type, target) {
    return currentRecord = new MutationRecord(type, target);
  }

  /**
   * Gets or creates a record with |oldValue| based in the |currentRecord|
   * @param {string} oldValue
   * @return {MutationRecord}
   */
  function getRecordWithOldValue(oldValue) {
    if (recordWithOldValue)
      return recordWithOldValue;
    recordWithOldValue = copyMutationRecord(currentRecord);
    recordWithOldValue.oldValue = oldValue;
    return recordWithOldValue;
  }

  function clearRecords() {
    currentRecord = recordWithOldValue = undefined;
  }

  /**
   * @param {MutationRecord} record
   * @return {boolean} Whether the record represents a record from the current
   * mutation event.
   */
  function recordRepresentsCurrentMutation(record) {
    return record === recordWithOldValue || record === currentRecord;
  }

  /**
   * Selects which record, if any, to replace the last record in the queue.
   * This returns |null| if no record should be replaced.
   *
   * @param {MutationRecord} lastRecord
   * @param {MutationRecord} newRecord
   * @param {MutationRecord}
   */
  function selectRecord(lastRecord, newRecord) {
    if (lastRecord === newRecord)
      return lastRecord;

    // Check if the the record we are adding represents the same record. If
    // so, we keep the one with the oldValue in it.
    if (recordWithOldValue && recordRepresentsCurrentMutation(lastRecord))
      return recordWithOldValue;

    return null;
  }

  /**
   * Class used to represent a registered observer.
   * @param {MutationObserver} observer
   * @param {Node} target
   * @param {MutationObserverInit} options
   * @constructor
   */
  function Registration(observer, target, options) {
    this.observer = observer;
    this.target = target;
    this.options = options;
    this.transientObservedNodes = [];
  }

  Registration.prototype = {
    enqueue: function(record) {
      var records = this.observer.records_;
      var length = records.length;

      // There are cases where we replace the last record with the new record.
      // For example if the record represents the same mutation we need to use
      // the one with the oldValue. If we get same record (this can happen as we
      // walk up the tree) we ignore the new record.
      if (records.length > 0) {
        var lastRecord = records[length - 1];
        var recordToReplaceLast = selectRecord(lastRecord, record);
        if (recordToReplaceLast) {
          records[length - 1] = recordToReplaceLast;
          return;
        }
      } else {
        scheduleCallback(this.observer);
      }

      records[length] = record;
    },

    addListeners: function() {
      this.addListeners_(this.target);
    },

    addListeners_: function(node) {
      var options = this.options;
      if (options.attributes)
        node.addEventListener('DOMAttrModified', this, true);

      if (options.characterData)
        node.addEventListener('DOMCharacterDataModified', this, true);

      if (options.childList)
        node.addEventListener('DOMNodeInserted', this, true);

      if (options.childList || options.subtree)
        node.addEventListener('DOMNodeRemoved', this, true);
    },

    removeListeners: function() {
      this.removeListeners_(this.target);
    },

    removeListeners_: function(node) {
      var options = this.options;
      if (options.attributes)
        node.removeEventListener('DOMAttrModified', this, true);

      if (options.characterData)
        node.removeEventListener('DOMCharacterDataModified', this, true);

      if (options.childList)
        node.removeEventListener('DOMNodeInserted', this, true);

      if (options.childList || options.subtree)
        node.removeEventListener('DOMNodeRemoved', this, true);
    },

    /**
     * Adds a transient observer on node. The transient observer gets removed
     * next time we deliver the change records.
     * @param {Node} node
     */
    addTransientObserver: function(node) {
      // Don't add transient observers on the target itself. We already have all
      // the required listeners set up on the target.
      if (node === this.target)
        return;

      this.addListeners_(node);
      this.transientObservedNodes.push(node);
      var registrations = registrationsTable.get(node);
      if (!registrations)
        registrationsTable.set(node, registrations = []);

      // We know that registrations does not contain this because we already
      // checked if node === this.target.
      registrations.push(this);
    },

    removeTransientObservers: function() {
      var transientObservedNodes = this.transientObservedNodes;
      this.transientObservedNodes = [];

      transientObservedNodes.forEach(function(node) {
        // Transient observers are never added to the target.
        this.removeListeners_(node);

        var registrations = registrationsTable.get(node);
        for (var i = 0; i < registrations.length; i++) {
          if (registrations[i] === this) {
            registrations.splice(i, 1);
            // Each node can only have one registered observer associated with
            // this observer.
            break;
          }
        }
      }, this);
    },

    handleEvent: function(e) {
      // Stop propagation since we are managing the propagation manually.
      // This means that other mutation events on the page will not work
      // correctly but that is by design.
      e.stopImmediatePropagation();

      switch (e.type) {
        case 'DOMAttrModified':
          // http://dom.spec.whatwg.org/#concept-mo-queue-attributes

          var name = e.attrName;
          var namespace = e.relatedNode.namespaceURI;
          var target = e.target;

          // 1.
          var record = new getRecord('attributes', target);
          record.attributeName = name;
          record.attributeNamespace = namespace;

          // 2.
          var oldValue =
              e.attrChange === MutationEvent.ADDITION ? null : e.prevValue;

          forEachAncestorAndObserverEnqueueRecord(target, function(options) {
            // 3.1, 4.2
            if (!options.attributes)
              return;

            // 3.2, 4.3
            if (options.attributeFilter && options.attributeFilter.length &&
                options.attributeFilter.indexOf(name) === -1 &&
                options.attributeFilter.indexOf(namespace) === -1) {
              return;
            }
            // 3.3, 4.4
            if (options.attributeOldValue)
              return getRecordWithOldValue(oldValue);

            // 3.4, 4.5
            return record;
          });

          break;

        case 'DOMCharacterDataModified':
          // http://dom.spec.whatwg.org/#concept-mo-queue-characterdata
          var target = e.target;

          // 1.
          var record = getRecord('characterData', target);

          // 2.
          var oldValue = e.prevValue;


          forEachAncestorAndObserverEnqueueRecord(target, function(options) {
            // 3.1, 4.2
            if (!options.characterData)
              return;

            // 3.2, 4.3
            if (options.characterDataOldValue)
              return getRecordWithOldValue(oldValue);

            // 3.3, 4.4
            return record;
          });

          break;

        case 'DOMNodeRemoved':
          this.addTransientObserver(e.target);
          // Fall through.
        case 'DOMNodeInserted':
          // http://dom.spec.whatwg.org/#concept-mo-queue-childlist
          var target = e.relatedNode;
          var changedNode = e.target;
          var addedNodes, removedNodes;
          if (e.type === 'DOMNodeInserted') {
            addedNodes = [changedNode];
            removedNodes = [];
          } else {

            addedNodes = [];
            removedNodes = [changedNode];
          }
          var previousSibling = changedNode.previousSibling;
          var nextSibling = changedNode.nextSibling;

          // 1.
          var record = getRecord('childList', target);
          record.addedNodes = addedNodes;
          record.removedNodes = removedNodes;
          record.previousSibling = previousSibling;
          record.nextSibling = nextSibling;

          forEachAncestorAndObserverEnqueueRecord(target, function(options) {
            // 2.1, 3.2
            if (!options.childList)
              return;

            // 2.2, 3.3
            return record;
          });

      }

      clearRecords();
    }
  };

  global.JsMutationObserver = JsMutationObserver;

  // Provide unprefixed MutationObserver with native or JS implementation
  if (!global.MutationObserver && global.WebKitMutationObserver)
    global.MutationObserver = global.WebKitMutationObserver;

  if (!global.MutationObserver)
    global.MutationObserver = JsMutationObserver;


})(this);

/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

/**
 * Implements `document.register`
 * @module CustomElements
*/

/**
 * Polyfilled extensions to the `document` object.
 * @class Document
*/

(function(scope) {

// imports

if (!scope) {
  scope = window.CustomElements = {flags:{}};
}
var flags = scope.flags;

// native document.registerElement?

var hasNative = Boolean(document.registerElement);
var useNative = !flags.register && hasNative;

if (useNative) {

  // stub
  var nop = function() {};

  // exports
  scope.registry = {};
  scope.upgradeElement = nop;

  scope.watchShadow = nop;
  scope.upgrade = nop;
  scope.upgradeAll = nop;
  scope.upgradeSubtree = nop;
  scope.observeDocument = nop;
  scope.upgradeDocument = nop;
  scope.takeRecords = nop;

} else {

  /**
   * Registers a custom tag name with the document.
   *
   * When a registered element is created, a `readyCallback` method is called
   * in the scope of the element. The `readyCallback` method can be specified on
   * either `options.prototype` or `options.lifecycle` with the latter taking
   * precedence.
   *
   * @method register
   * @param {String} name The tag name to register. Must include a dash ('-'),
   *    for example 'x-component'.
   * @param {Object} options
   *    @param {String} [options.extends]
   *      (_off spec_) Tag name of an element to extend (or blank for a new
   *      element). This parameter is not part of the specification, but instead
   *      is a hint for the polyfill because the extendee is difficult to infer.
   *      Remember that the input prototype must chain to the extended element's
   *      prototype (or HTMLElement.prototype) regardless of the value of
   *      `extends`.
   *    @param {Object} options.prototype The prototype to use for the new
   *      element. The prototype must inherit from HTMLElement.
   *    @param {Object} [options.lifecycle]
   *      Callbacks that fire at important phases in the life of the custom
   *      element.
   *
   * @example
   *      FancyButton = document.registerElement("fancy-button", {
   *        extends: 'button',
   *        prototype: Object.create(HTMLButtonElement.prototype, {
   *          readyCallback: {
   *            value: function() {
   *              console.log("a fancy-button was created",
   *            }
   *          }
   *        })
   *      });
   * @return {Function} Constructor for the newly registered type.
   */
  function register(name, options) {
    //console.warn('document.registerElement("' + name + '", ', options, ')');
    // construct a defintion out of options
    // TODO(sjmiles): probably should clone options instead of mutating it
    var definition = options || {};
    if (!name) {
      // TODO(sjmiles): replace with more appropriate error (EricB can probably
      // offer guidance)
      throw new Error('document.registerElement: first argument `name` must not be empty');
    }
    if (name.indexOf('-') < 0) {
      // TODO(sjmiles): replace with more appropriate error (EricB can probably
      // offer guidance)
      throw new Error('document.registerElement: first argument (\'name\') must contain a dash (\'-\'). Argument provided was \'' + String(name) + '\'.');
    }
    // elements may only be registered once
    if (getRegisteredDefinition(name)) {
      throw new Error('DuplicateDefinitionError: a type with name \'' + String(name) + '\' is already registered');
    }
    // must have a prototype, default to an extension of HTMLElement
    // TODO(sjmiles): probably should throw if no prototype, check spec
    if (!definition.prototype) {
      // TODO(sjmiles): replace with more appropriate error (EricB can probably
      // offer guidance)
      throw new Error('Options missing required prototype property');
    }
    // record name
    definition.__name = name.toLowerCase();
    // ensure a lifecycle object so we don't have to null test it
    definition.lifecycle = definition.lifecycle || {};
    // build a list of ancestral custom elements (for native base detection)
    // TODO(sjmiles): we used to need to store this, but current code only
    // uses it in 'resolveTagName': it should probably be inlined
    definition.ancestry = ancestry(definition.extends);
    // extensions of native specializations of HTMLElement require localName
    // to remain native, and use secondary 'is' specifier for extension type
    resolveTagName(definition);
    // some platforms require modifications to the user-supplied prototype
    // chain
    resolvePrototypeChain(definition);
    // overrides to implement attributeChanged callback
    overrideAttributeApi(definition.prototype);
    // 7.1.5: Register the DEFINITION with DOCUMENT
    registerDefinition(definition.__name, definition);
    // 7.1.7. Run custom element constructor generation algorithm with PROTOTYPE
    // 7.1.8. Return the output of the previous step.
    definition.ctor = generateConstructor(definition);
    definition.ctor.prototype = definition.prototype;
    // force our .constructor to be our actual constructor
    definition.prototype.constructor = definition.ctor;
    // if initial parsing is complete
    if (scope.ready) {
      // upgrade any pre-existing nodes of this type
      scope.upgradeAll(document);
    }
    return definition.ctor;
  }

  function ancestry(extnds) {
    var extendee = getRegisteredDefinition(extnds);
    if (extendee) {
      return ancestry(extendee.extends).concat([extendee]);
    }
    return [];
  }

  function resolveTagName(definition) {
    // if we are explicitly extending something, that thing is our
    // baseTag, unless it represents a custom component
    var baseTag = definition.extends;
    // if our ancestry includes custom components, we only have a
    // baseTag if one of them does
    for (var i=0, a; (a=definition.ancestry[i]); i++) {
      baseTag = a.is && a.tag;
    }
    // our tag is our baseTag, if it exists, and otherwise just our name
    definition.tag = baseTag || definition.__name;
    if (baseTag) {
      // if there is a base tag, use secondary 'is' specifier
      definition.is = definition.__name;
    }
  }

  function resolvePrototypeChain(definition) {
    // if we don't support __proto__ we need to locate the native level
    // prototype for precise mixing in
    if (!Object.__proto__) {
      // default prototype
      var nativePrototype = HTMLElement.prototype;
      // work out prototype when using type-extension
      if (definition.is) {
        var inst = document.createElement(definition.tag);
        nativePrototype = Object.getPrototypeOf(inst);
      }
      // ensure __proto__ reference is installed at each point on the prototype
      // chain.
      // NOTE: On platforms without __proto__, a mixin strategy is used instead
      // of prototype swizzling. In this case, this generated __proto__ provides
      // limited support for prototype traversal.
      var proto = definition.prototype, ancestor;
      while (proto && (proto !== nativePrototype)) {
        var ancestor = Object.getPrototypeOf(proto);
        proto.__proto__ = ancestor;
        proto = ancestor;
      }
    }
    // cache this in case of mixin
    definition.native = nativePrototype;
  }

  // SECTION 4

  function instantiate(definition) {
    // 4.a.1. Create a new object that implements PROTOTYPE
    // 4.a.2. Let ELEMENT by this new object
    //
    // the custom element instantiation algorithm must also ensure that the
    // output is a valid DOM element with the proper wrapper in place.
    //
    return upgrade(domCreateElement(definition.tag), definition);
  }

  function upgrade(element, definition) {
    // some definitions specify an 'is' attribute
    if (definition.is) {
      element.setAttribute('is', definition.is);
    }
    // remove 'unresolved' attr, which is a standin for :unresolved.
    element.removeAttribute('unresolved');
    // make 'element' implement definition.prototype
    implement(element, definition);
    // flag as upgraded
    element.__upgraded__ = true;
    // there should never be a shadow root on element at this point
    // we require child nodes be upgraded before `created`
    scope.upgradeSubtree(element);
    // lifecycle management
    created(element);
    // OUTPUT
    return element;
  }

  function implement(element, definition) {
    // prototype swizzling is best
    if (Object.__proto__) {
      element.__proto__ = definition.prototype;
    } else {
      // where above we can re-acquire inPrototype via
      // getPrototypeOf(Element), we cannot do so when
      // we use mixin, so we install a magic reference
      customMixin(element, definition.prototype, definition.native);
      element.__proto__ = definition.prototype;
    }
  }

  function customMixin(inTarget, inSrc, inNative) {
    // TODO(sjmiles): 'used' allows us to only copy the 'youngest' version of
    // any property. This set should be precalculated. We also need to
    // consider this for supporting 'super'.
    var used = {};
    // start with inSrc
    var p = inSrc;
    // sometimes the default is HTMLUnknownElement.prototype instead of
    // HTMLElement.prototype, so we add a test
    // the idea is to avoid mixing in native prototypes, so adding
    // the second test is WLOG
    while (p !== inNative && p !== HTMLUnknownElement.prototype) {
      var keys = Object.getOwnPropertyNames(p);
      for (var i=0, k; k=keys[i]; i++) {
        if (!used[k]) {
          Object.defineProperty(inTarget, k,
              Object.getOwnPropertyDescriptor(p, k));
          used[k] = 1;
        }
      }
      p = Object.getPrototypeOf(p);
    }
  }

  function created(element) {
    // invoke createdCallback
    if (element.createdCallback) {
      element.createdCallback();
    }
  }

  // attribute watching

  function overrideAttributeApi(prototype) {
    // overrides to implement callbacks
    // TODO(sjmiles): should support access via .attributes NamedNodeMap
    // TODO(sjmiles): preserves user defined overrides, if any
    if (prototype.setAttribute._polyfilled) {
      return;
    }
    var setAttribute = prototype.setAttribute;
    prototype.setAttribute = function(name, value) {
      changeAttribute.call(this, name, value, setAttribute);
    }
    var removeAttribute = prototype.removeAttribute;
    prototype.removeAttribute = function(name) {
      changeAttribute.call(this, name, null, removeAttribute);
    }
    prototype.setAttribute._polyfilled = true;
  }

  // https://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/custom/
  // index.html#dfn-attribute-changed-callback
  function changeAttribute(name, value, operation) {
    var oldValue = this.getAttribute(name);
    operation.apply(this, arguments);
    var newValue = this.getAttribute(name);
    if (this.attributeChangedCallback
        && (newValue !== oldValue)) {
      this.attributeChangedCallback(name, oldValue, newValue);
    }
  }

  // element registry (maps tag names to definitions)

  var registry = {};

  function getRegisteredDefinition(name) {
    if (name) {
      return registry[name.toLowerCase()];
    }
  }

  function registerDefinition(name, definition) {
    registry[name] = definition;
  }

  function generateConstructor(definition) {
    return function() {
      return instantiate(definition);
    };
  }

  function createElement(tag, typeExtension) {
    // TODO(sjmiles): ignore 'tag' when using 'typeExtension', we could
    // error check it, or perhaps there should only ever be one argument
    var definition = getRegisteredDefinition(typeExtension || tag);
    if (definition) {
      return new definition.ctor();
    }
    return domCreateElement(tag);
  }

  function upgradeElement(element) {
    if (!element.__upgraded__ && (element.nodeType === Node.ELEMENT_NODE)) {
      var type = element.getAttribute('is') || element.localName;
      var definition = getRegisteredDefinition(type);
      return definition && upgrade(element, definition);
    }
  }

  function cloneNode(deep) {
    // call original clone
    var n = domCloneNode.call(this, deep);
    // upgrade the element and subtree
    scope.upgradeAll(n);
    // return the clone
    return n;
  }
  // capture native createElement before we override it

  var domCreateElement = document.createElement.bind(document);

  // capture native cloneNode before we override it

  var domCloneNode = Node.prototype.cloneNode;

  // exports

  document.registerElement = register;
  document.createElement = createElement; // override
  Node.prototype.cloneNode = cloneNode; // override

  scope.registry = registry;

  /**
   * Upgrade an element to a custom element. Upgrading an element
   * causes the custom prototype to be applied, an `is` attribute
   * to be attached (as needed), and invocation of the `readyCallback`.
   * `upgrade` does nothing if the element is already upgraded, or
   * if it matches no registered custom tag name.
   *
   * @method ugprade
   * @param {Element} element The element to upgrade.
   * @return {Element} The upgraded element.
   */
  scope.upgrade = upgradeElement;
}

// bc
document.register = document.registerElement;

scope.hasNative = hasNative;
scope.useNative = useNative;

})(window.CustomElements);

 /*
Copyright 2013 The Polymer Authors. All rights reserved.
Use of this source code is governed by a BSD-style
license that can be found in the LICENSE file.
*/

(function(scope){

var logFlags = window.logFlags || {};

// walk the subtree rooted at node, applying 'find(element, data)' function
// to each element
// if 'find' returns true for 'element', do not search element's subtree
function findAll(node, find, data) {
  var e = node.firstElementChild;
  if (!e) {
    e = node.firstChild;
    while (e && e.nodeType !== Node.ELEMENT_NODE) {
      e = e.nextSibling;
    }
  }
  while (e) {
    if (find(e, data) !== true) {
      findAll(e, find, data);
    }
    e = e.nextElementSibling;
  }
  return null;
}

// walk all shadowRoots on a given node.
function forRoots(node, cb) {
  var root = node.shadowRoot;
  while(root) {
    forSubtree(root, cb);
    root = root.olderShadowRoot;
  }
}

// walk the subtree rooted at node, including descent into shadow-roots,
// applying 'cb' to each element
function forSubtree(node, cb) {
  //logFlags.dom && node.childNodes && node.childNodes.length && console.group('subTree: ', node);
  findAll(node, function(e) {
    if (cb(e)) {
      return true;
    }
    forRoots(e, cb);
  });
  forRoots(node, cb);
  //logFlags.dom && node.childNodes && node.childNodes.length && console.groupEnd();
}

// manage lifecycle on added node
function added(node) {
  if (upgrade(node)) {
    insertedNode(node);
    return true;
  }
  inserted(node);
}

// manage lifecycle on added node's subtree only
function addedSubtree(node) {
  forSubtree(node, function(e) {
    if (added(e)) {
      return true;
    }
  });
}

// manage lifecycle on added node and it's subtree
function addedNode(node) {
  return added(node) || addedSubtree(node);
}

// upgrade custom elements at node, if applicable
function upgrade(node) {
  if (!node.__upgraded__ && node.nodeType === Node.ELEMENT_NODE) {
    var type = node.getAttribute('is') || node.localName;
    var definition = scope.registry[type];
    if (definition) {
      logFlags.dom && console.group('upgrade:', node.localName);
      scope.upgrade(node);
      logFlags.dom && console.groupEnd();
      return true;
    }
  }
}

function insertedNode(node) {
  inserted(node);
  if (inDocument(node)) {
    forSubtree(node, function(e) {
      inserted(e);
    });
  }
}


// TODO(sorvell): on platforms without MutationObserver, mutations may not be
// reliable and therefore attached/detached are not reliable.
// To make these callbacks less likely to fail, we defer all inserts and removes
// to give a chance for elements to be inserted into dom.
// This ensures attachedCallback fires for elements that are created and
// immediately added to dom.
var hasPolyfillMutations = (!window.MutationObserver ||
    (window.MutationObserver === window.JsMutationObserver));
scope.hasPolyfillMutations = hasPolyfillMutations;

var isPendingMutations = false;
var pendingMutations = [];
function deferMutation(fn) {
  pendingMutations.push(fn);
  if (!isPendingMutations) {
    isPendingMutations = true;
    var async = (window.Platform && window.Platform.endOfMicrotask) ||
        setTimeout;
    async(takeMutations);
  }
}

function takeMutations() {
  isPendingMutations = false;
  var $p = pendingMutations;
  for (var i=0, l=$p.length, p; (i<l) && (p=$p[i]); i++) {
    p();
  }
  pendingMutations = [];
}

function inserted(element) {
  if (hasPolyfillMutations) {
    deferMutation(function() {
      _inserted(element);
    });
  } else {
    _inserted(element);
  }
}

// TODO(sjmiles): if there are descents into trees that can never have inDocument(*) true, fix this
function _inserted(element) {
  // TODO(sjmiles): it's possible we were inserted and removed in the space
  // of one microtask, in which case we won't be 'inDocument' here
  // But there are other cases where we are testing for inserted without
  // specific knowledge of mutations, and must test 'inDocument' to determine
  // whether to call inserted
  // If we can factor these cases into separate code paths we can have
  // better diagnostics.
  // TODO(sjmiles): when logging, do work on all custom elements so we can
  // track behavior even when callbacks not defined
  //console.log('inserted: ', element.localName);
  if (element.attachedCallback || element.detachedCallback || (element.__upgraded__ && logFlags.dom)) {
    logFlags.dom && console.group('inserted:', element.localName);
    if (inDocument(element)) {
      element.__inserted = (element.__inserted || 0) + 1;
      // if we are in a 'removed' state, bluntly adjust to an 'inserted' state
      if (element.__inserted < 1) {
        element.__inserted = 1;
      }
      // if we are 'over inserted', squelch the callback
      if (element.__inserted > 1) {
        logFlags.dom && console.warn('inserted:', element.localName,
          'insert/remove count:', element.__inserted)
      } else if (element.attachedCallback) {
        logFlags.dom && console.log('inserted:', element.localName);
        element.attachedCallback();
      }
    }
    logFlags.dom && console.groupEnd();
  }
}

function removedNode(node) {
  removed(node);
  forSubtree(node, function(e) {
    removed(e);
  });
}


function removed(element) {
  if (hasPolyfillMutations) {
    deferMutation(function() {
      _removed(element);
    });
  } else {
    _removed(element);
  }
}

function _removed(element) {
  // TODO(sjmiles): temporary: do work on all custom elements so we can track
  // behavior even when callbacks not defined
  if (element.attachedCallback || element.detachedCallback || (element.__upgraded__ && logFlags.dom)) {
    logFlags.dom && console.group('removed:', element.localName);
    if (!inDocument(element)) {
      element.__inserted = (element.__inserted || 0) - 1;
      // if we are in a 'inserted' state, bluntly adjust to an 'removed' state
      if (element.__inserted > 0) {
        element.__inserted = 0;
      }
      // if we are 'over removed', squelch the callback
      if (element.__inserted < 0) {
        logFlags.dom && console.warn('removed:', element.localName,
            'insert/remove count:', element.__inserted)
      } else if (element.detachedCallback) {
        element.detachedCallback();
      }
    }
    logFlags.dom && console.groupEnd();
  }
}

function inDocument(element) {
  var p = element;
  var doc = window.ShadowDOMPolyfill &&
      window.ShadowDOMPolyfill.wrapIfNeeded(document) || document;
  while (p) {
    if (p == doc) {
      return true;
    }
    p = p.parentNode || p.host;
  }
}

function watchShadow(node) {
  if (node.shadowRoot && !node.shadowRoot.__watched) {
    logFlags.dom && console.log('watching shadow-root for: ', node.localName);
    // watch all unwatched roots...
    var root = node.shadowRoot;
    while (root) {
      watchRoot(root);
      root = root.olderShadowRoot;
    }
  }
}

function watchRoot(root) {
  if (!root.__watched) {
    observe(root);
    root.__watched = true;
  }
}

function handler(mutations) {
  //
  if (logFlags.dom) {
    var mx = mutations[0];
    if (mx && mx.type === 'childList' && mx.addedNodes) {
        if (mx.addedNodes) {
          var d = mx.addedNodes[0];
          while (d && d !== document && !d.host) {
            d = d.parentNode;
          }
          var u = d && (d.URL || d._URL || (d.host && d.host.localName)) || '';
          u = u.split('/?').shift().split('/').pop();
        }
    }
    console.group('mutations (%d) [%s]', mutations.length, u || '');
  }
  //
  mutations.forEach(function(mx) {
    //logFlags.dom && console.group('mutation');
    if (mx.type === 'childList') {
      forEach(mx.addedNodes, function(n) {
        //logFlags.dom && console.log(n.localName);
        if (!n.localName) {
          return;
        }
        // nodes added may need lifecycle management
        addedNode(n);
      });
      // removed nodes may need lifecycle management
      forEach(mx.removedNodes, function(n) {
        //logFlags.dom && console.log(n.localName);
        if (!n.localName) {
          return;
        }
        removedNode(n);
      });
    }
    //logFlags.dom && console.groupEnd();
  });
  logFlags.dom && console.groupEnd();
};

var observer = new MutationObserver(handler);

function takeRecords() {
  // TODO(sjmiles): ask Raf why we have to call handler ourselves
  handler(observer.takeRecords());
  takeMutations();
}

var forEach = Array.prototype.forEach.call.bind(Array.prototype.forEach);

function observe(inRoot) {
  observer.observe(inRoot, {childList: true, subtree: true});
}

function observeDocument(document) {
  observe(document);
}

function upgradeDocument(document) {
  logFlags.dom && console.group('upgradeDocument: ', (document.URL || document._URL || '').split('/').pop());
  addedNode(document);
  logFlags.dom && console.groupEnd();
}

// exports

scope.watchShadow = watchShadow;
scope.upgradeAll = addedNode;
scope.upgradeSubtree = addedSubtree;

scope.observeDocument = observeDocument;
scope.upgradeDocument = upgradeDocument;

scope.takeRecords = takeRecords;

})(window.CustomElements);

/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function() {

// import

var IMPORT_LINK_TYPE = window.HTMLImports ? HTMLImports.IMPORT_LINK_TYPE : 'none';

// highlander object for parsing a document tree

var parser = {
  selectors: [
    'link[rel=' + IMPORT_LINK_TYPE + ']'
  ],
  map: {
    link: 'parseLink'
  },
  parse: function(inDocument) {
    if (!inDocument.__parsed) {
      // only parse once
      inDocument.__parsed = true;
      // all parsable elements in inDocument (depth-first pre-order traversal)
      var elts = inDocument.querySelectorAll(parser.selectors);
      // for each parsable node type, call the mapped parsing method
      forEach(elts, function(e) {
        parser[parser.map[e.localName]](e);
      });
      // upgrade all upgradeable static elements, anything dynamically
      // created should be caught by observer
      CustomElements.upgradeDocument(inDocument);
      // observe document for dom changes
      CustomElements.observeDocument(inDocument);
    }
  },
  parseLink: function(linkElt) {
    // imports
    if (isDocumentLink(linkElt)) {
      this.parseImport(linkElt);
    }
  },
  parseImport: function(linkElt) {
    if (linkElt.content) {
      parser.parse(linkElt.content);
    }
  }
};

function isDocumentLink(inElt) {
  return (inElt.localName === 'link'
      && inElt.getAttribute('rel') === IMPORT_LINK_TYPE);
}

var forEach = Array.prototype.forEach.call.bind(Array.prototype.forEach);

// exports

CustomElements.parser = parser;

})();
/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */
(function(scope){

// bootstrap parsing
function bootstrap() {
  // parse document
  CustomElements.parser.parse(document);
  // one more pass before register is 'live'
  CustomElements.upgradeDocument(document);
  // choose async
  var async = window.Platform && Platform.endOfMicrotask ?
    Platform.endOfMicrotask :
    setTimeout;
  async(function() {
    // set internal 'ready' flag, now document.registerElement will trigger
    // synchronous upgrades
    CustomElements.ready = true;
    // capture blunt profiling data
    CustomElements.readyTime = Date.now();
    if (window.HTMLImports) {
      CustomElements.elapsed = CustomElements.readyTime - HTMLImports.readyTime;
    }
    // notify the system that we are bootstrapped
    document.dispatchEvent(
      new CustomEvent('WebComponentsReady', {bubbles: true})
    );
  });
}

// CustomEvent shim for IE
if (typeof window.CustomEvent !== 'function') {
  window.CustomEvent = function(inType) {
    var e = document.createEvent('HTMLEvents');
    e.initEvent(inType, true, true);
    return e;
  };
}

// When loading at readyState complete time (or via flag), boot custom elements
// immediately.
// If relevant, HTMLImports must already be loaded.
if (document.readyState === 'complete' || scope.flags.eager) {
  bootstrap();
// When loading at readyState interactive time, bootstrap only if HTMLImports
// are not pending. Also avoid IE as the semantics of this state are unreliable.
} else if (document.readyState === 'interactive' && !window.attachEvent &&
    (!window.HTMLImports || window.HTMLImports.ready)) {
  bootstrap();
// When loading at other readyStates, wait for the appropriate DOM event to
// bootstrap.
} else {
  var loadEvent = window.HTMLImports && !HTMLImports.ready ?
      'HTMLImportsLoaded' : 'DOMContentLoaded';
  window.addEventListener(loadEvent, bootstrap);
}

})(window.CustomElements);

(function () {

/*** Variables ***/

  var win = window,
    doc = document,
    container = doc.createElement('div'),
    noop = function(){},
    trueop = function(){ return true; },
    regexPseudoSplit = /([\w-]+(?:\([^\)]+\))?)/g,
    regexPseudoReplace = /(\w*)(?:\(([^\)]*)\))?/,
    regexDigits = /(\d+)/g,
    keypseudo = {
      action: function (pseudo, event) {
        return pseudo.value.match(regexDigits).indexOf(String(event.keyCode)) > -1 == (pseudo.name == 'keypass') || null;
      }
    },
    /*
      - The prefix object generated here is added to the xtag object as xtag.prefix later in the code
      - Prefix provides a variety of prefix variations for the browser in which your code is running
      - The 4 variations of prefix are as follows:
        * prefix.dom: the correct prefix case and form when used on DOM elements/style properties
        * prefix.lowercase: a lowercase version of the prefix for use in various user-code situations
        * prefix.css: the lowercase, dashed version of the prefix
        * prefix.js: addresses prefixed APIs present in global and non-Element contexts
    */
    prefix = (function () {
      var styles = win.getComputedStyle(doc.documentElement, ''),
          pre = (Array.prototype.slice
            .call(styles)
            .join('')
            .match(/-(moz|webkit|ms)-/) || (styles.OLink === '' && ['', 'o'])
          )[1];
      return {
        dom: pre == 'ms' ? 'MS' : pre,
        lowercase: pre,
        css: '-' + pre + '-',
        js: pre == 'ms' ? pre : pre[0].toUpperCase() + pre.substr(1)
      };
    })(),
    matchSelector = Element.prototype.matchesSelector || Element.prototype[prefix.lowercase + 'MatchesSelector'],
    mutation = win.MutationObserver || win[prefix.js + 'MutationObserver'];

/*** Functions ***/

// Utilities

  /*
    This is an enhanced typeof check for all types of objects. Where typeof would normaly return
    'object' for many common DOM objects (like NodeLists and HTMLCollections).
    - For example: typeOf(document.children) will correctly return 'htmlcollection'
  */
  var typeCache = {},
      typeString = typeCache.toString,
      typeRegexp = /\s([a-zA-Z]+)/;
  function typeOf(obj) {
    var type = typeString.call(obj);
    return typeCache[type] || (typeCache[type] = type.match(typeRegexp)[1].toLowerCase());
  }

  function clone(item, type){
    var fn = clone[type || typeOf(item)];
    return fn ? fn(item) : item;
  }
    clone.object = function(src){
      var obj = {};
      for (var key in src) obj[key] = clone(src[key]);
      return obj;
    };
    clone.array = function(src){
      var i = src.length, array = new Array(i);
      while (i--) array[i] = clone(src[i]);
      return array;
    };

  /*
    The toArray() method allows for conversion of any object to a true array. For types that
    cannot be converted to an array, the method returns a 1 item array containing the passed-in object.
  */
  var unsliceable = ['undefined', 'null', 'number', 'boolean', 'string', 'function'];
  function toArray(obj){
    return unsliceable.indexOf(typeOf(obj)) == -1 ?
    Array.prototype.slice.call(obj, 0) :
    [obj];
  }

// DOM

  var str = '';
  function query(element, selector){
    return (selector || str).length ? toArray(element.querySelectorAll(selector)) : [];
  }

  function parseMutations(element, mutations) {
    var diff = { added: [], removed: [] };
    mutations.forEach(function(record){
      record._mutation = true;
      for (var z in diff) {
        var type = element._records[(z == 'added') ? 'inserted' : 'removed'],
          nodes = record[z + 'Nodes'], length = nodes.length;
        for (var i = 0; i < length && diff[z].indexOf(nodes[i]) == -1; i++){
          diff[z].push(nodes[i]);
          type.forEach(function(fn){
            fn(nodes[i], record);
          });
        }
      }
    });
  }

// Mixins

  function mergeOne(source, key, current){
    var type = typeOf(current);
    if (type == 'object' && typeOf(source[key]) == 'object') xtag.merge(source[key], current);
    else source[key] = clone(current, type);
    return source;
  }

  function wrapMixin(tag, key, pseudo, value, original){
    var fn = original[key];
    if (!(key in original)) original[key] = value;
    else if (typeof original[key] == 'function') {
      if (!fn.__mixins__) fn.__mixins__ = [];
      fn.__mixins__.push(xtag.applyPseudos(pseudo, value, tag.pseudos));
    }
  }

  var uniqueMixinCount = 0;
  function mergeMixin(tag, mixin, original, mix) {
    if (mix) {
      var uniques = {};
      for (var z in original) uniques[z.split(':')[0]] = z;
      for (z in mixin) {
        wrapMixin(tag, uniques[z.split(':')[0]] || z, z, mixin[z], original);
      }
    }
    else {
      for (var zz in mixin){
        original[zz + ':__mixin__(' + (uniqueMixinCount++) + ')'] = xtag.applyPseudos(zz, mixin[zz], tag.pseudos);
      }
    }
  }

  function applyMixins(tag) {
    tag.mixins.forEach(function (name) {
      var mixin = xtag.mixins[name];
      for (var type in mixin) {
        var item = mixin[type],
            original = tag[type];
        if (!original) tag[type] = item;
        else {
          switch (type){
            case 'accessors': case 'prototype':
              for (var z in item) {
                if (!original[z]) original[z] = item[z];
                else mergeMixin(tag, item[z], original[z], true);
              }
              break;
            default: mergeMixin(tag, item, original, type != 'events');
          }
        }
      }
      if (mixin.lifecycle && mixin.lifecycle.compile) {
        mixin.lifecycle.compile.call(mixin, tag);
      }
    });
    return tag;
  }

// Events

  function delegateAction(pseudo, event) {
    var match, target = event.target;
    if (!target.tagName) return null;
    if (xtag.matchSelector(target, pseudo.value)) match = target;
    else if (xtag.matchSelector(target, pseudo.value + ' *')) {
      var parent = target.parentNode;
      while (!match) {
        if (xtag.matchSelector(parent, pseudo.value)) match = parent;
        parent = parent.parentNode;
      }
    }
    return match ? pseudo.listener = pseudo.listener.bind(match) : null;
  }

  function touchFilter(event) {
    if (event.type.match('touch')){
      event.target.__touched__ = true;
    }
    else if (event.target.__touched__ && event.type.match('mouse')){
      delete event.target.__touched__;
      return;
    }
    return true;
  }

  function createFlowEvent(type) {
    var flow = type == 'over';
    return {
      attach: 'OverflowEvent' in win ? 'overflowchanged' : [],
      condition: function (event, custom) {
        event.flow = type;
        return event.type == (type + 'flow') ||
        ((event.orient === 0 && event.horizontalOverflow == flow) ||
        (event.orient == 1 && event.verticalOverflow == flow) ||
        (event.orient == 2 && event.horizontalOverflow == flow && event.verticalOverflow == flow));
      }
    };
  }

  function writeProperty(key, event, base, desc){
    if (desc) event[key] = base[key];
    else Object.defineProperty(event, key, {
      writable: true,
      enumerable: true,
      value: base[key]
    });
  }

  var skipProps = {};
  for (var z in doc.createEvent('CustomEvent')) skipProps[z] = 1;
  function inheritEvent(event, base){
    var desc = Object.getOwnPropertyDescriptor(event, 'target');
    for (var z in base) {
      if (!skipProps[z]) writeProperty(z, event, base, desc);
    }
    event.baseEvent = base;
  }

// Accessors

  function getArgs(attr, value){
    return {
      value: attr.boolean ? '' : value,
      method: attr.boolean && !value ? 'removeAttribute' : 'setAttribute'
    };
  }

  function modAttr(element, attr, name, value){
    var args = getArgs(attr, value);
    element[args.method](name, args.value);
  }

  function syncAttr(element, attr, name, value, method){
    var nodes = attr.property ? [element.xtag[attr.property]] : attr.selector ? xtag.query(element, attr.selector) : [],
        index = nodes.length;
    while (index--) nodes[index][method](name, value);
  }

  function updateView(element, name, value){
    if (element.__view__){
      element.__view__.updateBindingValue(element, name, value);
    }
  }

  function attachProperties(tag, prop, z, accessor, attr, name){
    var key = z.split(':'), type = key[0];
    if (type == 'get') {
      key[0] = prop;
      tag.prototype[prop].get = xtag.applyPseudos(key.join(':'), accessor[z], tag.pseudos, accessor[z]);
    }
    else if (type == 'set') {
      key[0] = prop;
      var setter = tag.prototype[prop].set = xtag.applyPseudos(key.join(':'), attr ? function(value){
        this.xtag._skipSet = true;
        if (!this.xtag._skipAttr) modAttr(this, attr, name, value);
        if (this.xtag._skipAttr && attr.skip) delete this.xtag._skipAttr;
        accessor[z].call(this, attr.boolean ? !!value : value);
        updateView(this, name, value);
        delete this.xtag._skipSet;
      } : accessor[z] ? function(value){
        accessor[z].call(this, value);
        updateView(this, name, value);
      } : null, tag.pseudos, accessor[z]);

      if (attr) attr.setter = setter;
    }
    else tag.prototype[prop][z] = accessor[z];
  }

  function parseAccessor(tag, prop){
    tag.prototype[prop] = {};
    var accessor = tag.accessors[prop],
        attr = accessor.attribute,
        name = attr && attr.name ? attr.name.toLowerCase() : prop;

    if (attr) {
      attr.key = prop;
      tag.attributes[name] = attr;
    }

    for (var z in accessor) attachProperties(tag, prop, z, accessor, attr, name);

    if (attr) {
      if (!tag.prototype[prop].get) {
        var method = (attr.boolean ? 'has' : 'get') + 'Attribute';
        tag.prototype[prop].get = function(){
          return this[method](name);
        };
      }
      if (!tag.prototype[prop].set) tag.prototype[prop].set = function(value){
        modAttr(this, attr, name, value);
        updateView(this, name, value);
      };
    }
  }

  var readyTags = {};
  function fireReady(name){
    readyTags[name] = (readyTags[name] || []).filter(function(obj){
      return (obj.tags = obj.tags.filter(function(z){
        return z != name && !xtag.tags[z];
      })).length || obj.fn();
    });
  }

/*** X-Tag Object Definition ***/

  var xtag = {
    tags: {},
    defaultOptions: {
      pseudos: [],
      mixins: [],
      events: {},
      methods: {},
      accessors: {},
      lifecycle: {},
      attributes: {},
      'prototype': {
        xtag: {
          get: function(){
            return this.__xtag__ ? this.__xtag__ : (this.__xtag__ = { data: {} });
          }
        }
      }
    },
    register: function (name, options) {
      var _name;
      if (typeof name == 'string') {
        _name = name.toLowerCase();
      } else {
        return;
      }

      // save prototype for actual object creation below
      var basePrototype = options.prototype;
      delete options.prototype;

      var tag = xtag.tags[_name] = applyMixins(xtag.merge({}, xtag.defaultOptions, options));

      for (var z in tag.events) tag.events[z] = xtag.parseEvent(z, tag.events[z]);
      for (z in tag.lifecycle) tag.lifecycle[z.split(':')[0]] = xtag.applyPseudos(z, tag.lifecycle[z], tag.pseudos, tag.lifecycle[z]);
      for (z in tag.methods) tag.prototype[z.split(':')[0]] = { value: xtag.applyPseudos(z, tag.methods[z], tag.pseudos, tag.methods[z]), enumerable: true };
      for (z in tag.accessors) parseAccessor(tag, z);

      var ready = tag.lifecycle.created || tag.lifecycle.ready;
      tag.prototype.createdCallback = {
        enumerable: true,
        value: function(){
          console.log('createdCallbac');
          var element = this;
          xtag.addEvents(this, tag.events);
          tag.mixins.forEach(function(mixin){
            if (xtag.mixins[mixin].events) xtag.addEvents(element, xtag.mixins[mixin].events);
          });

          var output = ready ? ready.apply(this, arguments) : null;
          console.log(ready, output);
          for (var name in tag.attributes) {
            var attr = tag.attributes[name],
                hasAttr = this.hasAttribute(name);
            if (hasAttr || attr.boolean) {
              this[attr.key] = attr.boolean ? hasAttr : this.getAttribute(name);
            }
          }
          tag.pseudos.forEach(function(obj){
            obj.onAdd.call(element, obj);
          });
          return output;
        }
      };

      var inserted = tag.lifecycle.inserted,
          removed = tag.lifecycle.removed;
      if (inserted || removed) {
        tag.prototype.attachedCallback = { value: function(){
          if (removed) this.xtag.__parentNode__ = this.parentNode;
          if (inserted) return inserted.apply(this, arguments);
        }, enumerable: true };
      }
      if (removed) {
        tag.prototype.detachedCallback = { value: function(){
          var args = toArray(arguments);
          args.unshift(this.xtag.__parentNode__);
          var output = removed.apply(this, args);
          delete this.xtag.__parentNode__;
          return output;
        }, enumerable: true };
      }
      if (tag.lifecycle.attributeChanged) tag.prototype.attributeChangedCallback = { value: tag.lifecycle.attributeChanged, enumerable: true };

      var setAttribute = tag.prototype.setAttribute || HTMLElement.prototype.setAttribute;
      tag.prototype.setAttribute = {
        writable: true,
        enumberable: true,
        value: function (name, value){
          var attr = tag.attributes[name.toLowerCase()];
          if (!this.xtag._skipAttr) setAttribute.call(this, name, attr && attr.boolean ? '' : value);
          if (attr) {
            if (attr.setter && !this.xtag._skipSet) {
              this.xtag._skipAttr = true;
              attr.setter.call(this, attr.boolean ? true : value);
            }
            value = attr.skip ? attr.boolean ? this.hasAttribute(name) : this.getAttribute(name) : value;
            syncAttr(this, attr, name, attr.boolean ? '' : value, 'setAttribute');
          }
          delete this.xtag._skipAttr;
        }
      };

      var removeAttribute = tag.prototype.removeAttribute || HTMLElement.prototype.removeAttribute;
      tag.prototype.removeAttribute = {
        writable: true,
        enumberable: true,
        value: function (name){
          var attr = tag.attributes[name.toLowerCase()];
          if (!this.xtag._skipAttr) removeAttribute.call(this, name);
          if (attr) {
            if (attr.setter && !this.xtag._skipSet) {
              this.xtag._skipAttr = true;
              attr.setter.call(this, attr.boolean ? false : undefined);
            }
            syncAttr(this, attr, name, undefined, 'removeAttribute');
          }
          delete this.xtag._skipAttr;
        }
      };

      var elementProto = basePrototype ?
            basePrototype :
            options['extends'] ?
            Object.create(doc.createElement(options['extends']).constructor).prototype :
            win.HTMLElement.prototype;

      var definition = {
        'prototype': Object.create(elementProto, tag.prototype)
      };
      if (options['extends']) {
        definition['extends'] = options['extends'];
      }
      var reg = doc.registerElement(_name, definition);
      fireReady(_name);
      return reg;
    },

    /*
      NEEDS MORE TESTING!

      Allows for async dependency resolution, fires when all passed-in elements are
      registered and parsed
    */
    ready: function(names, fn){
      var obj = { tags: toArray(names), fn: fn };
      if (obj.tags.reduce(function(last, name){
        if (xtag.tags[name]) return last;
        (readyTags[name] = readyTags[name] || []).push(obj);
      }, true)) fn();
    },

    /* Exposed Variables */

    mixins: {},
    prefix: prefix,
    captureEvents: ['focus', 'blur', 'scroll', 'underflow', 'overflow', 'overflowchanged', 'DOMMouseScroll'],
    customEvents: {
      overflow: createFlowEvent('over'),
      underflow: createFlowEvent('under'),
      animationstart: {
        attach: [prefix.dom + 'AnimationStart']
      },
      animationend: {
        attach: [prefix.dom + 'AnimationEnd']
      },
      transitionend: {
        attach: [prefix.dom + 'TransitionEnd']
      },
      move: {
        attach: ['mousemove', 'touchmove'],
        condition: touchFilter
      },
      enter: {
        attach: ['mouseover', 'touchenter'],
        condition: touchFilter
      },
      leave: {
        attach: ['mouseout', 'touchleave'],
        condition: touchFilter
      },
      scrollwheel: {
        attach: ['DOMMouseScroll', 'mousewheel'],
        condition: function(event){
          event.delta = event.wheelDelta ? event.wheelDelta / 40 : Math.round(event.detail / 3.5 * -1);
          return true;
        }
      },
      tapstart: {
        observe: {
          mousedown: doc,
          touchstart: doc
        },
        condition: touchFilter
      },
      tapend: {
        observe: {
          mouseup: doc,
          touchend: doc
        },
        condition: touchFilter
      },
      tapmove: {
        attach: ['tapstart', 'dragend', 'touchcancel'],
        condition: function(event, custom){
          switch (event.type) {
            case 'move':  return true;
            case 'dragover':
              var last = custom.lastDrag || {};
              custom.lastDrag = event;
              return (last.pageX != event.pageX && last.pageY != event.pageY) || null;
            case 'tapstart':
              if (!custom.move) {
                custom.current = this;
                custom.move = xtag.addEvents(this, {
                  move: custom.listener,
                  dragover: custom.listener
                });
                custom.tapend = xtag.addEvent(doc, 'tapend', custom.listener);
              }
              break;
            case 'tapend': case 'dragend': case 'touchcancel':
              if (!event.touches.length) {
                if (custom.move) xtag.removeEvents(custom.current , custom.move || {});
                if (custom.tapend) xtag.removeEvent(doc, custom.tapend || {});
                delete custom.lastDrag;
                delete custom.current;
                delete custom.tapend;
                delete custom.move;
              }
          }
        }
      }
    },
    pseudos: {
      __mixin__: {},
      /*


      */
      mixins: {
        onCompiled: function(fn, pseudo){
          var mixins = pseudo.source.__mixins__;
          if (mixins) switch (pseudo.value) {
            case 'before': return function(){
              var self = this,
                  args = arguments;
              mixins.forEach(function(m){
                m.apply(self, args);
              });
              return fn.apply(self, args);
            };
            case 'after': case null: return function(){
              var self = this,
                  args = arguments;
                  returns = fn.apply(self, args);
              mixins.forEach(function(m){
                m.apply(self, args);
              });
              return returns;
            };
          }
        }
      },
      keypass: keypseudo,
      keyfail: keypseudo,
      delegate: { action: delegateAction },
      within: {
        action: delegateAction,
        onAdd: function(pseudo){
          var condition = pseudo.source.condition;
          if (condition) pseudo.source.condition = function(event, custom){
            return xtag.query(this, pseudo.value).filter(function(node){
              return node == event.target || node.contains ? node.contains(event.target) : null;
            })[0] ? condition.call(this, event, custom) : null;
          };
        }
      },
      preventable: {
        action: function (pseudo, event) {
          return !event.defaultPrevented;
        }
      }
    },

    /* UTILITIES */

    clone: clone,
    typeOf: typeOf,
    toArray: toArray,

    wrap: function (original, fn) {
      return function(){
        var args = arguments,
            output = original.apply(this, args);
        fn.apply(this, args);
        return output;
      };
    },
    /*
      Recursively merges one object with another. The first argument is the destination object,
      all other objects passed in as arguments are merged from right to left, conflicts are overwritten
    */
    merge: function(source, k, v){
      if (typeOf(k) == 'string') return mergeOne(source, k, v);
      for (var i = 1, l = arguments.length; i < l; i++){
        var object = arguments[i];
        for (var key in object) mergeOne(source, key, object[key]);
      }
      return source;
    },

    /*
      ----- This should be simplified! -----
      Generates a random ID string
    */
    uid: function(){
      return Math.random().toString(36).substr(2,10);
    },

    /* DOM */

    query: query,

    skipTransition: function(element, fn, bind){
      var prop = prefix.js + 'TransitionProperty';
      element.style[prop] = element.style.transitionProperty = 'none';
      var callback = fn ? fn.call(bind) : null;
      return xtag.requestFrame(function(){
        xtag.requestFrame(function(){
          element.style[prop] = element.style.transitionProperty = '';
          if (callback) xtag.requestFrame(callback);
        });
      });
    },

    requestFrame: win.requestAnimationFrame ||
                  win[prefix.lowercase + 'RequestAnimationFrame'] ||
                  function(fn){ return win.setTimeout(fn, 20); },

    cancelFrame: win.cancelAnimationFrame ||
                 win[prefix.lowercase + 'CancelAnimationFrame'] ||
                 win.clearTimeout,

    matchSelector: function (element, selector) {
      return matchSelector.call(element, selector);
    },

    set: function (element, method, value) {
      element[method] = value;
      if (window.CustomElements) CustomElements.upgradeAll(element);
    },

    innerHTML: function(el, html){
      xtag.set(el, 'innerHTML', html);
    },

    hasClass: function (element, klass) {
      return element.className.split(' ').indexOf(klass.trim())>-1;
    },

    addClass: function (element, klass) {
      var list = element.className.trim().split(' ');
      klass.trim().split(' ').forEach(function (name) {
        if (!~list.indexOf(name)) list.push(name);
      });
      element.className = list.join(' ').trim();
      return element;
    },

    removeClass: function (element, klass) {
      var classes = klass.trim().split(' ');
      element.className = element.className.trim().split(' ').filter(function (name) {
        return name && !~classes.indexOf(name);
      }).join(' ');
      return element;
    },

    toggleClass: function (element, klass) {
      return xtag[xtag.hasClass(element, klass) ? 'removeClass' : 'addClass'].call(null, element, klass);
    },

    /*
      Runs a query on only the children of an element
    */
    queryChildren: function (element, selector) {
      var id = element.id,
        guid = element.id = id || 'x_' + xtag.uid(),
        attr = '#' + guid + ' > ',
        noParent = false;
      if (!element.parentNode){
        noParent = true;
        container.appendChild(element);
      }
      selector = attr + (selector + '').replace(',', ',' + attr, 'g');
      var result = element.parentNode.querySelectorAll(selector);
      if (!id) element.removeAttribute('id');
      if (noParent){
        container.removeChild(element);
      }
      return toArray(result);
    },
    /*
      Creates a document fragment with the content passed in - content can be
      a string of HTML, an element, or an array/collection of elements
    */
    createFragment: function(content) {
      var frag = doc.createDocumentFragment();
      if (content) {
        var div = frag.appendChild(doc.createElement('div')),
          nodes = toArray(content.nodeName ? arguments : !(div.innerHTML = content) || div.children),
          length = nodes.length,
          index = 0;
        while (index < length) frag.insertBefore(nodes[index++], div);
        frag.removeChild(div);
      }
      return frag;
    },

    /*
      Removes an element from the DOM for more performant node manipulation. The element
      is placed back into the DOM at the place it was taken from.
    */
    manipulate: function(element, fn){
      var next = element.nextSibling,
        parent = element.parentNode,
        frag = doc.createDocumentFragment(),
        returned = fn.call(frag.appendChild(element), frag) || element;
      if (next) parent.insertBefore(returned, next);
      else parent.appendChild(returned);
    },

    /* PSEUDOS */

    applyPseudos: function(key, fn, target, source) {
      var listener = fn,
          pseudos = {};
      if (key.match(':')) {
        var split = key.match(regexPseudoSplit),
            i = split.length;
        while (--i) {
          split[i].replace(regexPseudoReplace, function (match, name, value) {
            if (!xtag.pseudos[name]) throw "pseudo not found: " + name + " " + split;
            value = (value === '' || typeof value == 'undefined') ? null : value;
            var pseudo = pseudos[i] = Object.create(xtag.pseudos[name]);
            pseudo.key = key;
            pseudo.name = name;
            pseudo.value = value;
            pseudo['arguments'] = (value || '').split(',');
            pseudo.action = pseudo.action || trueop;
            pseudo.source = source;
            var last = listener;
            listener = function(){
              var args = toArray(arguments),
                  obj = {
                    key: key,
                    name: name,
                    value: value,
                    source: source,
                    'arguments': pseudo['arguments'],
                    listener: last
                  };
              var output = pseudo.action.apply(this, [obj].concat(args));
              if (output === null || output === false) return output;
              return obj.listener.apply(this, args);
            };
            if (target && pseudo.onAdd) {
              if (target.nodeName) pseudo.onAdd.call(target, pseudo);
              else target.push(pseudo);
            }
          });
        }
      }
      for (var z in pseudos) {
        if (pseudos[z].onCompiled) listener = pseudos[z].onCompiled(listener, pseudos[z]) || listener;
      }
      return listener;
    },

    removePseudos: function(target, pseudos){
      pseudos.forEach(function(obj){
        if (obj.onRemove) obj.onRemove.call(target, obj);
      });
    },

  /*** Events ***/

    parseEvent: function(type, fn) {
      var pseudos = type.split(':'),
          key = pseudos.shift(),
          custom = xtag.customEvents[key],
          event = xtag.merge({
            type: key,
            stack: noop,
            condition: trueop,
            attach: [],
            _attach: [],
            pseudos: '',
            _pseudos: [],
            onAdd: noop,
            onRemove: noop
          }, custom || {});
      event.attach = toArray(event.base || event.attach);
      event.chain = key + (event.pseudos.length ? ':' + event.pseudos : '') + (pseudos.length ? ':' + pseudos.join(':') : '');
      var condition = event.condition;
      event.condition = function(e){
        var t = e.touches, tt = e.targetTouches;
        return condition.apply(this, arguments);
      };
      var stack = xtag.applyPseudos(event.chain, fn, event._pseudos, event);
      event.stack = function(e){
        e.currentTarget = e.currentTarget || this;
        var t = e.touches, tt = e.targetTouches;
        var detail = e.detail || {};
        if (!detail.__stack__) return stack.apply(this, arguments);
        else if (detail.__stack__ == stack) {
          e.stopPropagation();
          e.cancelBubble = true;
          return stack.apply(this, arguments);
        }
      };
      event.listener = function(e){
        var args = toArray(arguments),
            output = event.condition.apply(this, args.concat([event]));
        if (!output) return output;
        // The second condition in this IF is to address the following Blink regression: https://code.google.com/p/chromium/issues/detail?id=367537
        // Remove this when affected browser builds with this regression fall below 5% marketshare
        if (e.type != key && (e.baseEvent && e.type != e.baseEvent.type)) {
          xtag.fireEvent(e.target, key, {
            baseEvent: e,
            detail: output !== true && (output.__stack__ = stack) ? output : { __stack__: stack }
          });
        }
        else return event.stack.apply(this, args);
      };
      event.attach.forEach(function(name) {
        event._attach.push(xtag.parseEvent(name, event.listener));
      });
      if (custom && custom.observe && !custom.__observing__) {
        custom.observer = function(e){
          var output = event.condition.apply(this, toArray(arguments).concat([custom]));
          if (!output) return output;
          xtag.fireEvent(e.target, key, {
            baseEvent: e,
            detail: output !== true ? output : {}
          });
        };
        for (var z in custom.observe) xtag.addEvent(custom.observe[z] || document, z, custom.observer, true);
        custom.__observing__ = true;
      }
      return event;
    },

    addEvent: function (element, type, fn, capture) {
      var event = typeof fn == 'function' ? xtag.parseEvent(type, fn) : fn;
      event._pseudos.forEach(function(obj){
        obj.onAdd.call(element, obj);
      });
      event._attach.forEach(function(obj) {
        xtag.addEvent(element, obj.type, obj);
      });
      event.onAdd.call(element, event, event.listener);
      element.addEventListener(event.type, event.stack, capture || xtag.captureEvents.indexOf(event.type) > -1);
      return event;
    },

    addEvents: function (element, obj) {
      var events = {};
      for (var z in obj) {
        events[z] = xtag.addEvent(element, z, obj[z]);
      }
      return events;
    },

    removeEvent: function (element, type, event) {
      event = event || type;
      event.onRemove.call(element, event, event.listener);
      xtag.removePseudos(element, event._pseudos);
      event._attach.forEach(function(obj) {
        xtag.removeEvent(element, obj);
      });
      element.removeEventListener(event.type, event.stack);
    },

    removeEvents: function(element, obj){
      for (var z in obj) xtag.removeEvent(element, obj[z]);
    },

    fireEvent: function(element, type, options, warn){
      var event = doc.createEvent('CustomEvent');
      options = options || {};
      if (warn) console.warn('fireEvent has been modified');
      event.initCustomEvent(type,
        options.bubbles !== false,
        options.cancelable !== false,
        options.detail
      );
      if (options.baseEvent) inheritEvent(event, options.baseEvent);
      try { element.dispatchEvent(event); }
      catch (e) {
        console.warn('This error may have been caused by a change in the fireEvent method', e);
      }
    },

    /*
      Listens for insertion or removal of nodes from a given element using
      Mutation Observers, or Mutation Events as a fallback
    */
    addObserver: function(element, type, fn){
      if (!element._records) {
        element._records = { inserted: [], removed: [] };
        if (mutation){
          element._observer = new mutation(function(mutations) {
            parseMutations(element, mutations);
          });
          element._observer.observe(element, {
            subtree: true,
            childList: true,
            attributes: !true,
            characterData: false
          });
        }
        else ['Inserted', 'Removed'].forEach(function(type){
          element.addEventListener('DOMNode' + type, function(event){
            event._mutation = true;
            element._records[type.toLowerCase()].forEach(function(fn){
              fn(event.target, event);
            });
          }, false);
        });
      }
      if (element._records[type].indexOf(fn) == -1) element._records[type].push(fn);
    },

    removeObserver: function(element, type, fn){
      var obj = element._records;
      if (obj && fn){
        obj[type].splice(obj[type].indexOf(fn), 1);
      }
      else{
        obj[type] = [];
      }
    }

  };

/*** Universal Touch ***/

var touching = false,
    touchTarget = null;

doc.addEventListener('mousedown', function(e){
  touching = true;
  touchTarget = e.target;
}, true);

doc.addEventListener('mouseup', function(){
  touching = false;
  touchTarget = null;
}, true);

doc.addEventListener('dragend', function(){
  touching = false;
  touchTarget = null;
}, true);

var UIEventProto = {
  touches: {
    configurable: true,
    get: function(){
      return this.__touches__ ||
        (this.identifier = 0) ||
        (this.__touches__ = touching ? [this] : []);
    }
  },
  targetTouches: {
    configurable: true,
    get: function(){
      return this.__targetTouches__ || (this.__targetTouches__ =
        (touching && this.currentTarget &&
        (this.currentTarget == touchTarget ||
        (this.currentTarget.contains && this.currentTarget.contains(touchTarget)))) ? (this.identifier = 0) || [this] : []);
    }
  },
  changedTouches: {
    configurable: true,
    get: function(){
      return this.__changedTouches__ || (this.identifier = 0) || (this.__changedTouches__ = [this]);
    }
  }
};

for (z in UIEventProto){
  UIEvent.prototype[z] = UIEventProto[z];
  Object.defineProperty(UIEvent.prototype, z, UIEventProto[z]);
}


/*** Custom Event Definitions ***/

  function addTap(el, tap, e){
    if (!el.__tap__) {
      el.__tap__ = { click: e.type == 'mousedown' };
      if (el.__tap__.click) el.addEventListener('click', tap.observer);
      else {
        el.__tap__.scroll = tap.observer.bind(el);
        window.addEventListener('scroll', el.__tap__.scroll, true);
        el.addEventListener('touchmove', tap.observer);
        el.addEventListener('touchcancel', tap.observer);
        el.addEventListener('touchend', tap.observer);
      }
    }
    if (!el.__tap__.click) {
      el.__tap__.x = e.touches[0].pageX;
      el.__tap__.y = e.touches[0].pageY;
    }
  }

  function removeTap(el, tap){
    if (el.__tap__) {
      if (el.__tap__.click) el.removeEventListener('click', tap.observer);
      else {
        window.removeEventListener('scroll', el.__tap__.scroll, true);
        el.removeEventListener('touchmove', tap.observer);
        el.removeEventListener('touchcancel', tap.observer);
        el.removeEventListener('touchend', tap.observer);
      }
      delete el.__tap__;
    }
  }

  function checkTapPosition(el, tap, e){
    var touch = e.changedTouches[0],
        tol = tap.gesture.tolerance;
    if (
      touch.pageX < el.__tap__.x + tol &&
      touch.pageX > el.__tap__.x - tol &&
      touch.pageY < el.__tap__.y + tol &&
      touch.pageY > el.__tap__.y - tol
    ) return true;
  }

  xtag.customEvents.tap = {
    observe: {
      mousedown: document,
      touchstart: document
    },
    gesture: {
      tolerance: 8
    },
    condition: function(e, tap){
      var el = e.target;
      switch (e.type) {
        case 'touchstart':
          if (el.__tap__ && el.__tap__.click) removeTap(el, tap);
          addTap(el, tap, e);
          return;
        case 'mousedown':
          if (!el.__tap__) addTap(el, tap, e);
          return;
        case 'scroll':
        case 'touchcancel':
          removeTap(this, tap);
          return;
        case 'touchmove':
        case 'touchend':
          if (this.__tap__ && !checkTapPosition(this, tap, e)) {
            removeTap(this, tap);
            return;
          }
          return e.type == 'touchend' || null;
        case 'click':
          removeTap(this, tap);
          return true;
      }
    }
  };

  win.xtag = xtag;
  if (typeof define == 'function' && define.amd) define(xtag);

  doc.addEventListener('WebComponentsReady', function(){
    xtag.fireEvent(doc.body, 'DOMComponentsLoaded');
  });

})();
