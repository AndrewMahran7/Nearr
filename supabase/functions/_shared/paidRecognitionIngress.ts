/** Synchronous recognition has no admission/settlement transaction. */
export async function checkSynchronousRecognitionPolicy(client: any): Promise<'allowed' | 'requires_job' | 'unavailable'> {
  try {
    const result = await client.from('nearr_plus_config').select('paid_find_policy_enabled').eq('id',true).single();
    if (result.error || typeof result.data?.paid_find_policy_enabled !== 'boolean') return 'unavailable';
    return result.data.paid_find_policy_enabled ? 'requires_job' : 'allowed';
  } catch { return 'unavailable'; }
}
