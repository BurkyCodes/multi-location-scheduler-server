import jwt from "jsonwebtoken";

// user authentication
export const checkAuthentication = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ message: "No token or invalid token, authorization denied" });
    }

    const token = authHeader.split(" ")[1];
    const isCustomAuth = token.length < 500;
    let decodedData;

    if (token && isCustomAuth) {
      const jwtsecret = process.env.LOGIN_SECRET;
      decodedData = jwt.verify(token, jwtsecret);
      req.userId = decodedData?.id;
      req.userOrgId = decodedData?.userOrgId;
    } else {
      decodedData = jwt.decode(token);
      req.userId = decodedData?.sub;
      req.userOrgId = decodedData?.userOrgId;
    }

    return next();
  } catch (error) {
    return res
      .status(401)
      .json({ message: "No token or invalid token, authorization denied" });
  }
};
