-- Пересчёт уже опубликованных рецензий на шкалу «итог = среднее критериев».
-- Триггер reviews_server_fields требует Telegram JWT, поэтому на время UPDATE его гасим.

ALTER TABLE public.reviews DISABLE TRIGGER reviews_server_fields;

UPDATE public.reviews
SET
  rating = objective_rating,
  base_rating = GREATEST(1, LEAST(10, round(objective_rating)::integer));

ALTER TABLE public.reviews ENABLE TRIGGER reviews_server_fields;
