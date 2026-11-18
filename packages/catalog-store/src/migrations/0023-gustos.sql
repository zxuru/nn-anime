-- El perfil de gustos de la encuesta de arranque en frío.
--
-- Una fila por usuario. Hoy sólo existe `local`, porque RoNa no tiene cuentas,
-- pero la clave va escrita para no tener que migrar la forma cuando las haya.
--
-- El perfil se guarda como un JSON y no en columnas: se lee entero para
-- recomendar y se escribe entero desde la encuesta, así que partirlo en cinco
-- tablas sólo añadiría transacciones y ninguna consulta. La validación de la
-- forma la hace `tasteProfileSchema` en la frontera del repositorio, igual que
-- los ajustes.
--
-- `updated_at` está también fuera del JSON para poder ordenar o podar sin
-- abrirlo. No se indexa: una fila por usuario no justifica un índice.

CREATE TABLE taste_profile (
  user_id     TEXT    PRIMARY KEY NOT NULL,
  profile_json TEXT   NOT NULL,
  updated_at  INTEGER NOT NULL
);
