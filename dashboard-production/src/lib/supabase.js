import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let client;
if (supabaseUrl && supabaseKey) {
  client = createClient(supabaseUrl, supabaseKey);
} else {
  const emptyResult = { data: [], error: null };
  const nullResult = { data: null, error: null };

  function makeChain(result) {
    return {
      select: () => makeChain(emptyResult),
      order: () => makeChain(emptyResult),
      eq: () => makeChain(emptyResult),
      ilike: () => makeChain(emptyResult),
      limit: () => makeChain(emptyResult),
      single: () => makeChain(nullResult),
      then: (onResolve, onReject) => Promise.resolve(result).then(onResolve, onReject),
      catch: (onReject) => Promise.resolve(result).catch(onReject),
    };
  }

  client = {
    from: () => makeChain(emptyResult),
  };
  console.warn('Supabase not configured — add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file');
}

export const supabase = client;


