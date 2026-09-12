const ACCOUNT_TYPES = ['checking', 'savings', 'credit_card', 'brokerage', 'loan'];

function validateAccountInput(input) {
  const errors = [];
  const { nickname, type, institution_name: institutionName, last_four: lastFour } = input || {};

  if (typeof nickname !== 'string' || nickname.trim() === '') {
    errors.push('nickname is required');
  }

  if (typeof institutionName !== 'string' || institutionName.trim() === '') {
    errors.push('institution_name is required');
  }

  if (!ACCOUNT_TYPES.includes(type)) {
    errors.push(`type must be one of: ${ACCOUNT_TYPES.join(', ')}`);
  }

  if (lastFour !== undefined && lastFour !== null && lastFour !== '' && !/^\d{4}$/.test(lastFour)) {
    errors.push('last_four must be exactly 4 digits');
  }

  return errors;
}

module.exports = { validateAccountInput, ACCOUNT_TYPES };
