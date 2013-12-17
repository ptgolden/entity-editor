(function (window) {

  'use strict';

  var slice = [].slice
    , filter = [].filter
    , some = [].some

  window.EntityEditor = EntityEditor;

  function EntityEditor(el, options) {
    var that = this;

    this.el = el;
    this.$el = $(el);
    this.html = this.getValue();

    this.entityObserver = new MutationObserver(this.removePrunedEntities.bind(this));
    this.$el.on('ee:entityLinked', function (e, data) {
      that.entityObserver.observe(data.el, { characterData: true, subtree: true });
    });

    this.$el.on('input', that.oninput.bind(that));
    this.$el.on('keypress', that.unselectAnchors.bind(that));
    this.$el.trigger('ee:init');

    return this;
  }

  EntityEditor.prototype.ENTITY_REGEX = /\[([^\]<]{1,50})\]/g;

  EntityEditor.prototype.getValue = function () {
    return this.el.innerHTML.trim();
  }

  EntityEditor.prototype.oninput = function () {
    this.html = this.getValue();
    this.fixEmptyEls();
    this.replaceEntities();
    this.$el.trigger('ee:input');
  }

  EntityEditor.prototype.removePrunedEntities = function (mutations) {
    var anchor
      , text
      , mutation
      , range
      , childs

    for (var i = 0; i < mutations.length; i++) {
      mutation = mutations[i];
      anchor = mutation.target.parentNode;
      break;
    }

    if (!anchor) return; // parent was removed (better way to check?)

    text = anchor.textContent;
    if (text.substr(0, 1) !== '[' || text.substr(-1, 1) !== ']') {
      range = rangy.createRange();
      range.selectNode(anchor);

      this.saveCursorPosition();
      childs = slice.call(anchor.childNodes);
      childs.forEach(function (node) { anchor.parentNode.insertBefore(node, anchor) });
      anchor.remove();
      this.restoreCursorPosition();
      this.el.normalize();
    }
  }

  EntityEditor.prototype.unselectAnchors = function (e) {
    var selection
      , anchorNode
      , range

    // If key* event is a special (i.e. non-printing) character, don't do anything
    if (e.which === 0) return;

    selection = rangy.getSelection();

    // Check if the selection is inside an anchor node
    if (selection.focusNode.nodeType === Node.TEXT_NODE &&
        selection.focusNode.parentNode.nodeName.toUpperCase() === 'A') {
      anchorNode = selection.focusNode.parentNode;
    } else if (selection.focusNode.nodeName === 'A') {
      anchorNode = selection.focusNode;
    }

    // If it's not, continue as normal
    if (!anchorNode) return;

    // If selection is at very start or very end of anchor, move it immediately
    // outside (before or after)
    if (selection.focusOffset === selection.focusNode.textContent.length) {
      range = rangy.createRange();
      range.collapseAfter(anchorNode);
      selection.removeAllRanges();
      selection.addRange(range);
      this.$el.one('keyup', this.el.normalize);
    } else if (selection.focusOffset === 0) {
      range = rangy.createRange();
      range.collapseBefore(anchorNode);
      selection.removeAllRanges();
      selection.addRange(range);
      this.$el.one('keyup', this.el.normalize);
    }
  }

  EntityEditor.prototype.fixEmptyEls = function () {
    filter.call(this.el.getElementsByTagName('a'), function (el) {
      return !el.text.length;
    }).forEach(function (el) {
      el.remove();
    });
  }

  EntityEditor.prototype.saveCursorPosition = function () {
    var selection = rangy.getSelection()
      , insertAfter = true
      , prevChar 
      , range

    if (selection.focusOffset > 0) {
      prevChar = selection.focusNode.textContent.substr(selection.focusOffset - 1, 1);
      if (prevChar === '[') {
        insertAfter = false;
      }
    }

    this.placeholderEl = this.placeholderEl || window.document.createElement('span');
    if (insertAfter) {
      this.placeholderEl.inserted = 'after';
      selection.getRangeAt(0).insertNode(this.placeholderEl);
    } else {
      this.placeholderEl.inserted = 'before';
      range = rangy.createRange();
      range.collapseToPoint(selection.focusNode, selection.focusOffset - 1);
      range.insertNode(this.placeholderEl);
    }
  }

  EntityEditor.prototype.restoreCursorPosition = function () {
    var selection
     ,  placeholderRange
     ,  nextRange

    if (!this.placeholderEl) return;

    selection = rangy.getSelection();
    placeholderRange = rangy.createRange();
    this.el.normalize();

    // If the span was inserted BEFORE the cursor previously, restore the
    // cursor in the next text node in the tree, offset by one
    if (this.placeholderEl.inserted === 'before' &&
        this.placeholderEl.nextSibling &&
        this.placeholderEl.nextSibling.textContent.length > 0) {

      nextRange = rangy.createRange();
      nextRange.selectNode(this.placeholderEl.nextSibling);
      placeholderRange.collapseToPoint(nextRange.getNodes([3])[0], 1);
    } else {
      // Otherwise, go ahead and replace the cursor at the span
      placeholderRange.selectNode(this.placeholderEl);
      placeholderRange.collapse(false);
    }
    selection.removeAllRanges();
    selection.addRange(placeholderRange);
    this.placeholderEl.parentNode.removeChild(this.placeholderEl);
  }

  EntityEditor.prototype.replaceEntities = function () {
    var that = this
      , thereIsANeed
      , selection
      , textNodes

    this.el.normalize();

    thereIsANeed = some.call(this.el.childNodes, function (el) {
      return el.nodeType === Node.TEXT_NODE &&
        el.textContent.search(that.ENTITY_REGEX) > -1;
    });

    if (!thereIsANeed) return;

    selection = rangy.getSelection();
    this.saveCursorPosition();

    // Only deal with text nodes
    textNodes = filter.call(this.el.childNodes, function (el) {
      return el.nodeType === Node.TEXT_NODE;
    });

    // For each text node, search for entity regex and wrap results in an anchor
    textNodes.forEach(function (node) {
      var results = []
        , matches

      while ( (matches = this.ENTITY_REGEX.exec(node.textContent)) != null ) {
        results.push({
          start: matches.index,
          end: this.ENTITY_REGEX.lastIndex,
          text: node.textContent.substring(matches.index + 1, this.ENTITY_REGEX.lastIndex - 1)
        })
      }

      // Start from the back so that we don't have to recalculate indexes
      results.reverse();

      results.forEach(function (result) {
        var range = rangy.createRange()
          , wrap
          , anchor

        wrap = node.splitText(result.start);
        wrap.splitText(result.end - result.start);

        range.selectNode(wrap);
        selection.removeAllRanges();
        selection.addRange(range);
        window.document.execCommand('createLink', false, '#');

        anchor = wrap.parentNode;
        $(anchor).addClass('ee-entity');
        this.$el.trigger('ee:entityLinked', { el: anchor, text: result.text });

      }, this);

    }, this);

    this.restoreCursorPosition();
    this.el.normalize();
  }

})(window);
