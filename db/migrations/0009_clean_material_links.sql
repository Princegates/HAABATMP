-- Learning-material links are only ever http(s). Anything else (javascript:, data:, vbscript:) could run script when clicked, so it goes.
delete from learning_materials where url is not null and url !~* '^\s*https?://';
