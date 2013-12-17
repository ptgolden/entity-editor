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

    this.entities = [];

    this.entityObserver = new MutationObserver(this.onmutations.bind(this));
    this.entityObserver.observe(el, { childList: true });

    this.$el.on('input', that.oninput.bind(that));
    this.$el.on('keypress', that.unselectAnchors.bind(that));
    this.$el.trigger('ee:init');

    return this;
  }

  EntityEditor.prototype.ENTITY_REGEX = /\[([^\]<]{1,50})\]/g;

  EntityEditor.prototype.getValue = function () { return this.el.innerHTML.trim(); }

  EntityEditor.prototype.oninput = function () {
    this.html = this.getValue();
    this.fixEmptyEls();
    this.replaceEntities();
    this.$el.trigger('ee:input');
  }

  // Callback for editor's MutationObserver object. Checks whether entity
  // anchors were either edited or removed, then calls the appropriate
  // functions.
  EntityEditor.prototype.onmutations = function (mutations) {
    var anchorTextEdits = []
      , anchorRemovals = []

    anchorRemovals = mutations.filter(function (mutation) {
      return mutation.type === 'childList' &&
        mutation.removedNodes.length &&
        mutation.removedNodes[0].nodeName === 'A';
    }).map(function (mutation) {
      return mutation.removedNodes[0];
    });

    anchorTextEdits = mutations.filter(function (mutation) {
      return mutation.type === 'characterData' &&
        mutation.target.parentNode.nodeName.toUpperCase() === 'A';
    }).map(function (mutation) {
      return mutation.target.parentNode;
    }).reduce(function (arr, anchor) {
      return arr.indexOf(anchor) === -1 && anchorRemovals.indexOf(anchor) === -1
        ? arr.concat(anchor)
        : arr;
    }, []);

    anchorTextEdits.forEach(this.handleEditedAnchor, this);
    anchorRemovals.forEach(this.handleRemovedAnchor, this);
  }

  // When an anchor is added, observe it with the previously defined
  // MutationObserver, push it to the internal list of entities, and trigger
  // an `entityLinked` event.
  EntityEditor.prototype.handleAddedAnchor = function (anchor, text) {
    this.entityObserver.observe(anchor, { characterData: true, subtree: true });
    this.entities.push(anchor);
    this.$el.trigger('ee:entityLinked', { el: anchor, text: text });
  }

  // When an anchor's text is edited, either remove it if the edges of the text
  // are not the entity delimiters or trigger an `entityEdited` event. Anchor
  // edits are monitored by a MutationObserver object.
  EntityEditor.prototype.handleEditedAnchor = function (anchor) {
    var text = anchor.textContent;
    if (text.substr(0, 1) !== '[' || text.substr(-1, 1) !== ']') {
      this.unlinkAnchor(anchor);
    } else {
      this.$el.trigger('ee:entityEdited', [anchor]);
    }
  }

  // Replaces an anchor with its child elements. I use this function instead
  // of document.executeCommand('unlink') for two reasons. First, I'm sure
  // that it doesn't act the same across browsers. Second, in firefox, it just
  // removes the href attribute and leaves an "empty" anchor. Which is stupid.
  EntityEditor.prototype.unlinkAnchor = function (anchor) {
    var range = rangy.createRange();
    range.selectNode(anchor);
    this.saveCursorPosition();
    slice.call(anchor.childNodes).forEach(function (child) {
      anchor.parentNode.insertBefore(child, anchor);
    });
    anchor.remove();
    this.restoreCursorPosition();
    this.el.normalize();
  }

  // When an anchor is removed, remove it from the internal list of entities
  // and trigger an entityUnlinked event.
  EntityEditor.prototype.handleRemovedAnchor = function (anchor) {
    this.entities.pop(anchor);
    this.$el.trigger('ee:entityUnlinked');
  }

  // Function to prevent adding text at the margins of entity anchors.
  //
  // For example, in the entity <a>[John Doe]</a>, text should be able to be
  // added ONLY within the brackets.
  //
  // Meant to be called on keypress event. If the key is a printing character 
  // and the cursor is at the margin of an anchor, we move it outside before 
  // the character is actually entered.
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
        this.handleAddedAnchor(anchor, result.text);

      }, this);

    }, this);

    this.restoreCursorPosition();
    this.el.normalize();
  }

})(window);
