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

const getClientId = function() {
  return apiKeys[apiKeys.env].CLIENT_ID;
};

const getClientSecret = function() {
  return apiKeys[apiKeys.env].CLIENT_SECRET;
};

// server test
app.get("/hello", (req, res) => {
  return res.status(200).send("Hello from gitspeed");
});

// redirect link
app.get("/oauth", (req, res) => {
  return res
    .status(200)
    .send("Please wait, you will be redirected shortly");
});

app.delete("/delete-user", (req, res) => {
  const accessToken = req.body.access_token;
  const username = req.body.username;

  if(accessToken && username) {
    db.collection('users').doc(username).get().then((user) => {
      const token = user.data().access_token;
      console.log(token);
        if(token == accessToken) {
          db.collection('users').doc(username).delete();
        }
    }).catch((error) => functions.logger.error);
  }

  return res.status(200);

});

// fetch user token
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
          client_id: getClientId(),
          client_secret: getClientSecret(),
          code: code,
          state: state,
        },
      })
      .then((resp) => {
        const data = resp.data.split("&");
        var isResponseValid = false;
        var authResult = {};
        data.forEach((element) => {
          const entry = element.split("=");
          if (entry[0] === "access_token") isResponseValid = true;

          authResult[entry[0]] = entry[1];
        });

        // if there is no access token, then there is some error, so return the error data
        if (!isResponseValid) {
          return res.status(420).send(authResult);
        } else {
          // get access token
          const access_token = authResult.access_token;

          // use the access token to fetch the user details from github to save into firestore
          axios
            .get(githubUserProfileEndPoint, {
              headers: {
                Authorization: "token " + access_token,
              },
            })
            .then((resp) => {
              const userData = resp.data;
              const docId = userData.login;
              const dbUser = {
                name: userData.name,
                avatar_url: userData.avatar_url,
                email: userData.email,
                location: userData.location,
                access_token: access_token,
              };

              // set will create or update(if document already exists)
              db.collection("users")
                .doc(docId)
                .set(dbUser)
                .then((resp) => {
                  functions.logger.info("User add sucessful: " + docId);
                  dbUser.username = docId;
                  res.status(200).send({ user: dbUser });
                })
                .catch((error) => {
                  functions.logger.error(error);
                });
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
