function EntityEditor(el, options) {
  var that = this;

  this.el = el;
  this.$el = $(el);
  this.html = this.getValue();

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
  if (this.html == '<br>') {
    this.el.innerHTML = '';
  } else {

    Array.prototype.slice.call(this.el.getElementsByTagName('a'))
      .filter(function (el) {
        return !el.text.length;
      }).forEach(function (el) {
        el.remove();
      });

  }

}

EntityEditor.prototype.saveCursorPosition = function () {
  var selection = rangy.getSelection();

  this.placeholderEl = this.placeholderEl || document.createElement('span');
  selection.getRangeAt(0).insertNode(this.placeholderEl);
}

EntityEditor.prototype.restoreCursorPosition = function () {
  var selection, placeholderRange

  if (!this.placeholderEl) return;

  selection = rangy.getSelection();
  placeholderRange = rangy.createRange();
  placeholderRange.selectNode(this.placeholderEl);
  placeholderRange.collapse(false);
  selection.removeAllRanges();
  selection.addRange(placeholderRange);
  this.placeholderEl.parentNode.removeChild(this.placeholderEl);
}

EntityEditor.prototype.replaceEntities = function () {
  var that = this
    , thereIsANeed
    , selection
    , textNodes

  thereIsANeed = Array.prototype.some.call(this.el.childNodes, function (el) {
    return el.nodeType === Node.TEXT_NODE &&
      el.textContent.search(that.ENTITY_REGEX) > -1;
  });

  if (!thereIsANeed) return;

  selection = rangy.getSelection();
  this.saveCursorPosition();

  // Only deal with text nodes
  textNodes = Array.prototype.filter.call(this.el.childNodes, function (el) {
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
      document.execCommand('createLink', false, '#');

      anchor = wrap.parentNode;
      $(anchor).addClass('ee-entity');
      this.$el.trigger('ee:entityLinked', { el: anchor, text: result.text });

    }, this);

  }, this);

  this.restoreCursorPosition();
  this.el.normalize();

}

///////////////////////////////////////////////

var el = document.getElementById('editor')
  , editor = new EntityEditor(el)
  , $src = $('#editor-source')

function updateSource() {
  $src.text(editor.getValue());
}

editor.$el.on('ee:input', updateSource);
updateSource();
