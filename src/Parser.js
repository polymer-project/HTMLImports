/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(scope) {

var IMPORT_LINK_TYPE = 'import';
var isIe = /Trident/.test(navigator.userAgent)

// highlander object for parsing a document tree
var importParser = {
  selectors: [
    'link[rel=' + IMPORT_LINK_TYPE + ']',
    'link[rel=stylesheet]',
    'style',
    'script:not([type])',
    'script[type="text/javascript"]'
  ],
  map: {
    link: 'parseLink',
    script: 'parseScript',
    style: 'parseStyle'
  },
  parseNext: function() {
    var next = this.nextToParse();
    if (next) {
      this.parse(next);
      this.parseNext();
    }
  },
  parse: function(elt) {
    var fn = this[this.map[elt.localName]];
    if (fn) {
      elt.__parsed = true;
      fn.call(this, elt);
    }
  },
  parseImport: function(doc, done) {
    if (!doc.__importParsed) {
      // only parse once
      doc.__importParsed = true;
      if (done) {
        done();
      }
      return;
      var tracker = new LoadTracker(document, done);
      /*
      // all parsable elements in inDocument (depth-first pre-order traversal)
      var elts = document.querySelectorAll(importParser.selectors);
      // memoize the number of scripts
      var scriptCount = document.scripts ? document.scripts.length : 0;
      // for each parsable node type, call the mapped parsing method
      for (var i=0, e; i<elts.length && (e=elts[i]); i++) {
        this.parseElement(e);
        // if a script was injected, we need to requery our nodes
        // TODO(sjmiles): injecting nodes above the current script will
        // result in errors
        if (document.scripts && scriptCount !== document.scripts.length) {
          // memoize the new count
          scriptCount = document.scripts.length;
          // ensure we have any new nodes in our list
          elts = document.querySelectorAll(importParser.selectors);
        }
      }
      */
      //console.groupEnd('parsing', document.baseURI);
      tracker.open();
    } else if (done) {
      done();
    }
  },
  parseLink: function(linkElt) {
    if (isDocumentLink(linkElt)) {
      this.trackElement(linkElt);
      if (linkElt.__resource) {
        importParser.parse(linkElt.__resource, function() {
          // import is now ready so make available
          linkElt.import = linkElt.__resource;
          // fire load event
          linkElt.dispatchEvent(new CustomEvent('load', {bubbles: false}));
        });
      } else {
        linkElt.dispatchEvent(new CustomEvent('error', {bubbles: false}));
      }
    } else {
      // make href relative to main document
      if (needsMainDocumentContext(linkElt)) {
        linkElt.href = linkElt.href;
      }
      this.parseGeneric(linkElt);
    }
  },
  trackElement: function(elt) {
    return;
    // IE doesn't fire load on style elements
    if (!isIe || elt.localName !== 'style') {
      elt.ownerDocument.__loadTracker.require(elt);
    }
  },
  parseStyle: function(elt) {
    // TODO(sorvell): style element load event can just not fire so clone styles
    elt = needsMainDocumentContext(elt) ? cloneStyle(elt) : elt;
    this.parseGeneric(elt);
  },
  parseGeneric: function(elt) {
    // TODO(sorvell): because of a style element needs to be out of 
    // tree to fire the load event, avoid the check for parentNode that
    // needsMainDocumentContext does. Why was that necessary? if it is, 
    // refactor this.
    //if (needsMainDocumentContext(elt)) {
    if (!inMainDocument(elt)) {
      this.trackElement(elt);
      document.head.appendChild(elt);
    }
  },
  parseScript: function(scriptElt) {
    if (needsMainDocumentContext(scriptElt)) {
      // acquire code to execute
      var code = (scriptElt.__resource || scriptElt.textContent).trim();
      if (code) {
        // calculate source map hint
        var moniker = scriptElt.__nodeUrl;
        if (!moniker) {
          moniker = scriptElt.ownerDocument.baseURI;
          // there could be more than one script this url
          var tag = '[' + Math.floor((Math.random()+1)*1000) + ']';
          // TODO(sjmiles): Polymer hack, should be pluggable if we need to allow 
          // this sort of thing
          var matches = code.match(/Polymer\(['"]([^'"]*)/);
          tag = matches && matches[1] || tag;
          // tag the moniker
          moniker += '/' + tag + '.js';
        }
        // source map hint
        code += "\n//# sourceURL=" + moniker + "\n";
        // evaluate the code
        scope.currentScript = scriptElt;
        eval.call(window, code);
        scope.currentScript = null;
      }
    }
  },
  nextToParse: function() {
    return this.nextToParseInDoc(document);
  },
  nextToParseInDoc: function(doc) {
    var nodes = doc.querySelectorAll(this.selectors);
    for (var i=0, l=nodes.length, n; (i<l) && (n=nodes[i]); i++) {
      if (!n.__parsed) {
        return (nodeIsImport(n) && n.__resource) ?
            this.nextToParseInDoc(n.__resource) || n :
            n;
      }
    }
  }/*,
  canParse: function(node) {
    var doc = node.ownerDocument;
    return nextImportToParse() === node;
  }*/
};

// clone style with proper path resolution for main document
// NOTE: styles are the only elements that require direct path fixup.
function cloneStyle(style) {
  var clone = style.ownerDocument.createElement('style');
  clone.textContent = relativeCssForStyle(style);
  return clone;
}

function relativeCssForStyle(style) {
  var doc = style.ownerDocument;
  var resolver = doc.createElement('a');
  var cssText = replaceUrlsInCssText(style.textContent, resolver,
      CSS_URL_REGEXP);
  return replaceUrlsInCssText(cssText, resolver, CSS_IMPORT_REGEXP);  
}

var CSS_URL_REGEXP = /(url\()([^)]*)(\))/g;
var CSS_IMPORT_REGEXP = /(@import[\s]*)([^;]*)(;)/g;
function replaceUrlsInCssText(cssText, resolver, regexp) {
  return cssText.replace(regexp, function(m, pre, url, post) {
    var urlPath = url.replace(/["']/g, '');
    resolver.href = urlPath;
    urlPath = resolver.href;
    return pre + '\'' + urlPath + '\'' + post;
  });
}

function LoadTracker(doc, callback) {
  this.doc = doc;
  this.doc.__loadTracker = this;
  this.callback = callback;
}

LoadTracker.prototype = {
  pending: 0,
  isOpen: false,
  open: function() {
    this.isOpen = true;
    this.checkDone();
  },
  add: function() {
    this.pending++;
  },
  require: function(elt) {
    this.add();
    //console.log('require', elt, this.pending);
    var names = ['load', 'error'], self = this;
    for (var i=0, l=names.length, n; (i<l) && (n=names[i]); i++) {
      elt.addEventListener(n, function(e) {
        self.receive(e);
      });
    }
  },
  receive: function(e) {
    this.pending--;
    //console.log('receive', e.target, this.pending);
    this.checkDone();
  },
  checkDone: function() {
    if (!this.isOpen) {
      return;
    }
    if (this.pending <= 0 && this.callback) {
      //console.log('done!', this.doc, this.doc.baseURI);
      this.isOpen = false;
      this.callback();
    }
  }
}

function nodeIsImport(elt) {
  return (elt.localName === 'link') && (elt.rel === 'import');
}

function isDocumentLink(elt) {
  return elt.localName === 'link'
      && elt.getAttribute('rel') === IMPORT_LINK_TYPE;
}

function needsMainDocumentContext(node) {
  // nodes can be moved to the main document:
  // if they are in a tree but not in the main document
  return node.parentNode && !inMainDocument(node);
}

function inMainDocument(elt) {
  return elt.ownerDocument === document ||
    // TODO(sjmiles): ShadowDOMPolyfill intrusion
    elt.ownerDocument.impl === document;
}

// exports
scope.parser = importParser;

})(HTMLImports);