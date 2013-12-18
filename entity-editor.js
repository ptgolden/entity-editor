(function (window) {

  'use strict';

  var slice = [].slice
    , filter = [].filter
    , some = [].some
    , zeroSpaceObserver

  window.EntityEditor = EntityEditor;

  zeroSpaceObserver = new MutationObserver(function (mutations, observer) {
    var textNode = mutations[0].target
      , selection = rangy.getSelection()
      , range = rangy.createRange()

    observer.disconnect();
    textNode.textContent = textNode.textContent.slice(1);
    range.collapseToPoint(textNode, 1)
    selection.removeAllRanges();
    selection.addRange(range);
  });

  function EntityEditor(el, options) {
    var that = this;

    this.el = el;
    this.$el = $(el);
    this.html = this.getValue();

    this.entities = [];

    this.entityObserver = new MutationObserver(this.onmutations.bind(this));
    this.entityObserver.observe(el, { childList: true, subtree: true });

    this.$el.on('input', that.oninput.bind(that));
    this.$el.on('keypress', that.unselectAnchors.bind(that));
    this.$el.trigger('ee:init');

    return this;
  }

  EntityEditor.prototype.ENTITY_REGEX = /\[([^\]<]{1,50})\]/g;

  EntityEditor.prototype.getValue = function () { return this.el.innerHTML.trim(); }

  EntityEditor.prototype.oninput = function () {
    this.el.normalize();
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
      , anchorAdditions = []

    anchorRemovals = mutations.filter(function (mutation) {
      return mutation.type === 'childList' &&
        mutation.removedNodes.length &&
        mutation.removedNodes[0].nodeName === 'A';
    }).map(function (mutation) {
      return mutation.removedNodes[0];
    });

    anchorAdditions = mutations.filter(function (mutation) {
      return mutation.type === 'childList' &&
        mutation.addedNodes.length &&
        mutation.addedNodes[0].nodeName === 'A';
    }).map(function (mutation) {
      return mutation.addedNodes[0];
    });

    anchorTextEdits = mutations.filter(function (mutation) {
      return mutation.type === 'characterData' &&
        mutation.target.parentNode &&
        mutation.target.parentNode.nodeName.toUpperCase() === 'A';
    }).map(function (mutation) {
      return mutation.target.parentNode;
    });

    // Anchor was split into two (by a new paragraph, for example)
    if (anchorRemovals.length === 1 && anchorAdditions.length === 2) {
      anchorAdditions.forEach(this.unlinkAnchor, this);
    }

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
    var text = anchor.textContent
      , containsBR

    if (!anchor.parentNode) return;

    if (text.substr(0, 1) !== '[' || text.substr(-1, 1) !== ']') {
      this.unlinkAnchor(anchor);
    } else if (anchor.children.length) {
      containsBR = Array.some(anchor.children, function (el) {
        return el.nodeName.toUpperCase() === 'BR';
      });
      if (containsBR) this.unlinkAnchor(anchor);
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

  EntityEditor.prototype.linkRange = function (range) {
    var anchor = document.createElement('a')
      , selection = rangy.getSelection()
      , selectionRange = selection.rangeCount && selection.getRangeAt(0)
      , node
      , newSelectionRange
      , newSelectionOffset
    
    if (selectionRange
        && range.commonAncestorContainer === selectionRange.commonAncestorContainer
        && range.startOffset <= selectionRange.startOffset <= range.endOffset) {
      node = selectionRange.commonAncestorContainer;
      newSelectionRange = rangy.createRange();
      newSelectionOffset = selectionRange.endOffset - range.startOffset;
    }

    range.surroundContents(anchor);
    if (newSelectionRange) {
      newSelectionRange = rangy.createRange();
      newSelectionRange.collapseToPoint(anchor.childNodes[0], newSelectionOffset);
      selection.removeAllRanges();
      selection.addRange(newSelectionRange);
    }
    anchor.classList.add('ee-entity');
    this.handleAddedAnchor(anchor);
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
      , zeroSpaceTextRange

    // If key* event is a special (i.e. non-printing) character, don't do anything
    if (e.which === 0 || e.which === 8) return;

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
      zeroSpaceTextRange = document.createTextNode('\u200B');
      anchorNode.parentNode.insertBefore(zeroSpaceTextRange, anchorNode.nextSibling);
      range = rangy .createRange();
      range.selectNode(zeroSpaceTextRange);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      zeroSpaceObserver.observe(zeroSpaceTextRange, { characterData: true });
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

  EntityEditor.prototype.getNonEntityTextNodes = function () {
    var range = rangy.createRange();
    range.selectNode(this.el);
    return range.getNodes([3], function(node) {
      return node.parentNode.nodeName.toUpperCase() !== 'A';
    });
  }

  EntityEditor.prototype.replaceEntities = function () {
    var that = this
      , textNodes = this.getNonEntityTextNodes()
      , needed
      , selection

    needed = textNodes.some(function (node) {
      return node.textContent.search(that.ENTITY_REGEX) > -1;
    });

    if (!needed) return;

    // For each text node, search for entity regex and wrap results in an anchor
    textNodes.forEach(function (node) {
      var entityRanges = []
        , matches
        , range

      while ( (matches = this.ENTITY_REGEX.exec(node.textContent)) != null ) {
        range = rangy.createRange();
        range.setStart(node, matches.index);
        range.setEnd(node, this.ENTITY_REGEX.lastIndex)
        entityRanges.push(range);
      }

      // Start from the back so that we don't have to recalculate indexes
      entityRanges.reverse();
      entityRanges.forEach(this.linkRange, this);
    }, this);

    this.el.normalize();
  }

})(window);
