-- Re-fold the personal dictionary's lookup keys.
--
-- The key was case-folded but kept whatever apostrophe was typed, and the
-- manuscript holds the typeset one while a keyboard produces the straight one.
-- So "Brandan’s" and "Brandan's" were two different words as far as the table
-- was concerned, and a word taught in one form went on being flagged in the
-- other.
--
-- Any pair that differs only by the shape of its apostrophe is now the same
-- word, so the later of the two goes before the key is rebuilt — otherwise the
-- update would collide with its own uniqueness constraint.

DELETE FROM dictionary_words a
USING dictionary_words b
WHERE a.id <> b.id
  AND lower(replace(replace(replace(a.word, '‘', ''''), '’', ''''), 'ʼ', ''''))
    = lower(replace(replace(replace(b.word, '‘', ''''), '’', ''''), 'ʼ', ''''))
  AND (a.created_at, a.id) > (b.created_at, b.id);

UPDATE dictionary_words
SET word_folded = lower(replace(replace(replace(word, '‘', ''''), '’', ''''), 'ʼ', ''''));
