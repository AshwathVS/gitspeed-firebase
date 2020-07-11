/**
  Firebase Constants
*/
const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const serviceAccount = require("./permissions.json");
const axios = require("axios").default;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://gitti-space-sl.firebaseio.com",
});

const db = admin.firestore();

const app = express();
app.use(cors({ origin: true }));

/**
  App Constants
*/
const apiKeys = require("./apiKeys.json");
const { user } = require("firebase-functions/lib/providers/auth");
const githubAccessTokenEndPoint = "https://github.com/login/oauth/access_token";
const githubUserProfileEndPoint = "https://api.github.com/user";

app.get("/hello", (req, res) => {
  return res.status(200).send("Hello from gitti-space");
});

app.post("/fetch-user-token", (req, res) => {
  if (!req.body.code || !req.body.state) {
    return res.status(422).send("Invalid request");
  } else {
    // fetch details from request body
    const code = req.body.code;
    const state = req.body.state;

    // post call to github access token uri to fetch the token
    axios
      .post(githubAccessTokenEndPoint, null, {
        params: {
          client_id: apiKeys.CLIENT_ID,
          client_secret: apiKeys.CLIENT_SECRET,
          code: code,
          state: state,
        },
      })
      .then((resp) => {
        const data = resp.data.split("&");
        var isResponseValid = false;
        var result = {};
        data.forEach((element) => {
          const entry = element.split("=");
          if (entry[0] === "access_token") isResponseValid = true;

          result[entry[0]] = entry[1];
        });

        const access_token = result.access_token;
        // if there is no access token, then there is some error, so return the error data
        if (!isResponseValid) {
          return res.status(420).send(result);
        } else {
          // use the access token to fetch the user details from github to save into firestore
          axios
            .get(githubUserProfileEndPoint, {
              headers: {
                Authorization: "token " + access_token,
              },
            })
            .then((resp) => {
              const userData = resp.data;

              // check if user already exists
              db.collection("users")
                .where("username", "==", userData.login)
                .get()
                .then((snapshot) => {
                  // update access_token if user already exists
                  if (!snapshot.empty) {
                    snapshot.forEach((doc) => {
                      db.collection("users")
                        .doc(doc.id)
                        .update({ access_token: access_token });
                    });
                  }
                  // create new user if not
                  else {
                    db.collection("users").add({
                      username: userData.login,
                      name: userData.name,
                      avatar_url: userData.avatar_url,
                      email: userData.name,
                      location: userData.location,
                      access_token: access_token,
                    });
                  }
                });
              return res.status(200).send(result);
            })
            .catch((error) => {
              functions.logger.error(error);
            });
        }
      })
      .catch((error) => {
        return res.status(500).send(error);
      });
  }
});

exports.api = functions.https.onRequest(app);
