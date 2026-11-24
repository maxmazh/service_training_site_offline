const SUPABASE_URL = "https://ffspihdjdoidekxutqhf.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_bGrg0AdXvjEWe-_c1oV9rw_OiHr7jaf";

// Подключаем Supabase SDK
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

// Делаем клиент доступным другим скриптам сайта
window.supabaseClient = supabase;

console.log("Supabase успешно подключён");