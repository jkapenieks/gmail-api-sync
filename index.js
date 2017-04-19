var fs = require('fs');
var google = require('googleapis');
var gmailApiParser = require('gmail-api-parse-message');
var googleAuth = require('google-auth-library');
var googleBatch = require('google-batch');
var batch = new googleBatch();
var googleApiBatch = googleBatch.require('googleapis');

var SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
var credentials = null;
var clientSecretPath;

var setClientSecretsFile = function (path) {
    clientSecretPath = path;
};

// Load client secrets from a local file.
var loadClientSecrets = function (callback) {
    fs.readFile(clientSecretPath, function processClientSecrets(err, content) {
        if (err) {
            console.log('Error loading client secret file: ' + err);
            return callback(err);
        } else {
            credentials = JSON.parse(content);
            return callback();
        }
    });
};

function checkCredentials(callback) {
    if (credentials === null) {
        loadClientSecrets(function (err) {
            if (err) {
                console.error("Error loading credentials.");
                return callback(err);
            }
            else {
                return callback();
            }
        })
    } else {
        return callback();
    }
}

function createOauth2Client() {
    var clientSecret = credentials.installed.client_secret;
    var clientId = credentials.installed.client_id;
    var redirectUrl = credentials.installed.redirect_uris[0];
    var auth = new googleAuth();
    return new auth.OAuth2(clientId, clientSecret, redirectUrl);
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 *
 */
function getNewServerAuthCode() {
    checkCredentials(function (err) {
        if (err) {
            console.error("Unable to load credentials. Is Client secret set?");
            return;
        }
        var oauth2Client = createOauth2Client();
        var authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES
        });
        console.log('Authorize this app by visiting this url: ', authUrl);

    });
}


/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 *
 * @param {Object} accessToken The token to create an Oauth2 object.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorizeWithToken(accessToken, callback) {
    if (accessToken === null) {
        return callback(new Error('serverAuthCode cannot be null'), null);
    }
    checkCredentials(function (err) {
        if (err) {
            return callback(err, null);
        }
        var oauth2Client = createOauth2Client();
        oauth2Client.credentials = accessToken;
        callback(null, oauth2Client);
    });
}

function getNewAccesToken(serverAuthCode, callback) {
    checkCredentials(function (err) {
        if (err) {
            return callback(err, null);
        }
        var oauth2Client = createOauth2Client();
        oauth2Client.getToken(serverAuthCode, function (err, token) {
            if (err) {
                return callback(new Error('Error while trying to retrieve access token. ' + err), null);
            } else {
                return callback(null, token);
            }
        });
    });

}

function authorizeWithServerAuth(serverAuthCode, callback) {
    getNewAccesToken(serverAuthCode, function (err, token) {
        if (err) {
            return callback(new Error('Error while trying to retrieve access token. ' + err), null);
        } else {
            var oauth2Client = createOauth2Client();
            oauth2Client.credentials = token;
            callback(null, oauth2Client);
        }
    });
}

function partialSyncListMessagesInitial(auth, historyId, callback) {
    var gmail = google.gmail('v1');
    gmail.users.history.list({
        auth: auth,
        userId: 'me',
        startHistoryId: historyId,
        historyTypes: 'messageAdded'
    }, function (err, response) {
        if (err) {
            return callback(new Error('partialSyncListMessagesInitial: The API returned an error: ' + err), null);
        }
        else {
            return callback(null, response);
        }
    });
}
function partialSyncListMessagesPage(auth, resp, messages, callback) {
    var newMessages = [];
    if (resp.history == null) {
        return callback(null, messages);
    }
    resp.history.forEach(function (item) {
        newMessages.push(item.messages[0]);
    });
    messages = messages.concat(newMessages);

    var nextPageToken = resp.nextPageToken;
    if (nextPageToken) {
        var gmail = google.gmail('v1');
        gmail.users.history.list({
            auth: auth,
            userId: 'me',
            pageToken: nextPageToken,
            startHistoryId: resp.historyId
        }, function (err, response) {
            if (err) {
                return callback(new Error('partialSyncListMessagesPage: The API returned an error: ' + err), null);
            } else {
                if (response.history != null) {
                }
                partialSyncListMessagesPage(auth, response, messages, callback);
            }
        });
    } else {
        console.log("New messages retrived: " + messages.length);
        callback(null, messages)
    }

}
function listMessagesInitial(auth, query, callback) {
    var gmail = google.gmail('v1');
    gmail.users.messages.list({
        auth: auth,
        userId: 'me',
        q: query
    }, function (err, response) {
        if (err) {
            return callback(new Error('listMessagesInitial: The API returned an error: ' + err), null);
        }
        else {
            callback(null, response)
        }
    });
}
function listMessagesPage(auth, query, resp, messages, callback) {
    if (resp.messages == null) {
        console.log("No new messages found: ");
        return callback(null, messages);
    }
    messages = messages.concat(resp.messages);

    var nextPageToken = resp.nextPageToken;
    if (nextPageToken) {
        var gmail = google.gmail('v1');
        gmail.users.messages.list({
            auth: auth,
            userId: 'me',
            pageToken: nextPageToken,
            q: query
        }, function (err, response) {
            if (err) {
                return callback(new Error('listMessagesPage: The API returned an error: ' + err), null);
            } else {
                if (response.messages != null) {
                }
                listMessagesPage(auth, query, response, messages, callback);
            }
        });
    } else {
        console.log("New messages retrived: " + messages.length);
        callback(null, messages)
    }

}

function fullSyncListMessages(auth, query, callback) {
    var messages = [];
    listMessagesInitial(auth, query, function (err, resp) {
        if (err) {
            return callback(err, null);
        }
        listMessagesPage(auth, query, resp, messages, function (err, messages) {
            if (err) {
                return callback(err, null);
            }
            callback(null, messages);
        })
    });
}

function partialSyncListMessages(auth, historyId, callback) {
    var messages = [];
    partialSyncListMessagesInitial(auth, historyId, function (err, resp) {
        if (err) {
            return callback(err, null);
        }
        partialSyncListMessagesPage(auth, resp, messages, function (err, messages) {
            if (err) {
                return callback(err, null);
            }
            callback(null, messages);
        })
    });
}

var getHeader = function (headers, name) {
    var header = '';
    headers.forEach(function (entry) {
        if (entry.name === name) {
            header = entry.value;
        }
    });
    return header;
};

function getMessages(auth, messageIds, callback) {
    batch.setAuth(auth);
    var gmail = googleApiBatch.gmail({
        version: 'v1'
    });
    var messages = [];
    messageIds.forEach(function (messageId) {
        var params = {
            googleBatch: true,
            userId: "me",
            id: messageId.id
        };
        batch.add(gmail.users.messages.get(params));
    });

    batch.exec(function (err, responses, errorDetails) {
        if (err) {
            return callback(new Error('The API returned an error: ' + JSON.stringify(errorDetails)), null);
        }

        responses.forEach(function (response) {
            if (response.body.payload != null) {
                var subject = getHeader(response.body.payload.headers, 'Subject');
                var from = getHeader(response.body.payload.headers, 'From');
                var date = getHeader(response.body.payload.headers, 'Date');
                var id = response.body.id;

                var parsedMessage = gmailApiParser(response.body);
                var textHtml = parsedMessage.textHtml;
                var textPlain = parsedMessage.textPlain;
                var historyId = response.body.historyId;

                var message = {
                    id: id,
                    date: date,
                    from: from,
                    subject: subject,
                    textHtml: textHtml,
                    textPlain: textPlain,
                    historyId: historyId
                };
                messages.push(message);
            } else {
                //console.log("Skipping message with no body:" + JSON.stringify(response.body));
            }
        });
        batch.clear();
        callback(null, messages);
    });
}

var queryMessages = function (oauth, query, callback) {
    var response = {};
    fullSyncListMessages(oauth, query, function (err, messages) {
        if (err) {
            return callback(err, null);
        }
        if (messages.length === 0) {
            response.emails = [];
            return callback(null, response);
        }
        getMessages(oauth, messages, function (err, emails) {
            if (err) {
                return callback(err, null);
            }
            response.emails = emails;
            response.historyId = emails[0].historyId;
            callback(null, response);
        });
    });
};

var syncMessages = function (oauth, historyId, callback) {
    var response = {};
    partialSyncListMessages(oauth, historyId, function (err, messages) {
        if (err) {
            return callback(err, null);
        }
        if (messages.length === 0) {
            response.emails = [];
            return callback(null, response);
        }
        getMessages(oauth, messages, function (err, newEmails) {
            if (err) {
                return callback(err, null);
            }
            response.emails = newEmails;
            response.historyId = newEmails[newEmails.length - 1].historyId;
            callback(null, response);
        });
    });


};

module.exports = {
    setClientSecretsFile,
    getNewServerAuthCode,
    getNewAccesToken,
    authorizeWithToken,
    authorizeWithServerAuth,
    queryMessages,
    syncMessages,
    getMessages
};
