require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const admin = require('firebase-admin');

const port = process.env.PORT || 3000;

// firebase access token
// convert : base64 to utf8
const decodedKey = Buffer.from(
  process.env.FIREBASE_SERVICE_KEY,
  'base64'
).toString('utf8');
const serviceAccount = JSON.parse(decodedKey);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // create a collection
    const database = client.db('LearnNest');
    const usersCollection = database.collection('users');
    const teacherRequestCollection = database.collection('teachOnLearnNest');

    // done: firebase JWT
    const verifyFirebaseToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).send({ message: 'Unauthorized access' });
      }

      const token = authHeader.split(' ')[1];
      if (!token) {
        return res.status(401).send({ message: 'Unauthorized access' });
      }
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        console.log('yes decoded token', decoded);

        req.decoded = decoded;

        next();
      } catch (error) {
        console.log(error);
        return res.status(401).send({ message: 'Unauthorized access' });
      }
    };

    // user search (makeAdmin client)
    app.get('/users/search', verifyFirebaseToken, async (req, res) => {
      const emailQuery = req.query.email;

      const filter = {
        email: { $ne: req?.decoded?.email },
      };

      const regex = new RegExp(emailQuery, 'i'); //case-insensitive partial match

      try {
        let users;
        if (emailQuery) {
          users = await usersCollection
            .find({ email: { $regex: regex } })
            .limit(10)
            .toArray();
        } else {
          users = await usersCollection.find(filter).toArray();
        }

        res.send(users);
      } catch (error) {
        console.error('Error searching users', error);
        res.status(500).send({ message: 'Error searching users' });
      }
    });

    // save user data in db and update last login time
    app.post('/user', async (req, res) => {
      try {
        const userData = req.body;
        userData.role = 'student';
        userData.status = 'not-verified';
        userData.create_at = new Date().toISOString();
        userData.last_loggedIn = new Date().toISOString();

        const email = userData?.email;
        const alreadyExists = await usersCollection.findOne({ email });

        if (!!alreadyExists) {
          await usersCollection.updateOne(
            { email },
            { $set: { last_loggedIn: new Date().toISOString() } }
          );
          return res
            .status(200)
            .send({ message: 'User already exists', inserted: false });
        }

        const result = await usersCollection.insertOne(userData);
        res.send(result);
      } catch (error) {
        console.log(error);
        res.status(500).json({ error: error.message });
      }
    });

    // make admin
    app.patch('/make-admin/:id', async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;
      console.log(id, role);

      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              role: role,
              status: 'verified',
            },
          }
        );
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to update' });
      }
    });

    // save teacher request data in db
    app.post('/teacher-request', async (req, res) => {
      const teachOnData = req.body;
      teachOnData.status = 'pending';
      teachOnData.create_at = new Date().toISOString();
      teachOnData.last_request_at = new Date().toISOString();

      const email = teachOnData?.email;
      const alreadyRequest = await teacherRequestCollection.findOne({ email });
      if (!!alreadyRequest) {
        await teacherRequestCollection.updateOne(
          { email },
          {
            $set: {
              status: 'pending',
              last_request_at: new Date().toISOString(),
            },
          }
        );
        return res
          .status(200)
          .send({ message: 'User already exists', inserted: false });
      }

      const result = await teacherRequestCollection.insertOne(teachOnData);
      res.send(result);
    });

    // get all teacher request
    app.get('/all-request', verifyFirebaseToken, async (req, res) => {
      const result = await teacherRequestCollection.find().toArray();
      res.send(result);
    });

    // teacher request status update
    app.patch('/teacher-request-status/:id', async (req, res) => {
      const id = req.params.id;
      const { status, role, email } = req.body;

      try {
        await teacherRequestCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: { status: status },
          }
        );

        await usersCollection.updateOne(
          { email },
          {
            $set: { role: role },
          }
        );

        res.send({ message: 'Rider assigned' });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to update' });
      }
    });
    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 });
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    );
  } finally {
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Hello LearnNest!');
});

app.listen(port, () => {
  console.log(`LearnNest app listening on port ${port}`);
});
