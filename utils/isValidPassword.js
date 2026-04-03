const isValidPassword = (password) => {
  const isFourDigits = password.length === 4;
  const isNumeric = /^\d{4}$/.test(password);
  return isFourDigits && isNumeric;
};

export default isValidPassword;
