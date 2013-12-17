var el = document.getElementById('editor')
  , editor = new EntityEditor(el)
  , $src = $('#editor-source')

function updateSource() {
  setTimeout(function () { $src.text(editor.getValue()) }, 0, this);
}

editor.$el.on('ee:input', updateSource);
updateSource();
