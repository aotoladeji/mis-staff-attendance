// From the original SignDemo.html — base64 encode helper
const codeHandler = {
  encode: (str, encoding) => {
    if (encoding === 'base64') {
      // Use btoa for base64 encoding in browser
      return btoa(unescape(encodeURIComponent(str)));
    }
    return str;
  }
};

export default codeHandler;
