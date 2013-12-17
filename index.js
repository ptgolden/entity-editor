var el = document.getElementById('editor')
  , editor = new EntityEditor(el)
  , $src = $('#editor-source')

function updateSource() {
  setTimeout(() => $src.text(editor.getValue()), 0);
}

editor.$el.on('ee:input', updateSource);
updateSource();
