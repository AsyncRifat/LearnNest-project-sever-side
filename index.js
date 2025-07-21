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
    const classCollection = database.collection('all-class');

    // TODO: verify section ---> #1
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
        // console.log('yes decoded token', decoded);

        req.decoded = decoded;

        next();
      } catch (error) {
        console.log(error);
        return res.status(401).send({ message: 'Unauthorized access' });
      }
    };

    // custom middleware for Admin verify
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden Access' });
      }
      next();
    };

    // custom middleware for Admin verify
    const verifyTeacher = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== 'teacher') {
        return res.status(403).send({ message: 'Forbidden Access' });
      }
      next();
    };

    // TODO: admin section ---> #2
    // user search (makeAdmin client)
    app.get(
      '/users/search',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
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
      }
    );

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
    app.patch(
      '/make-admin/:id',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
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
      }
    );

    // get all teacher request
    app.get(
      '/all-request',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const result = await teacherRequestCollection.find().toArray();
        res.send(result);
      }
    );

    // teacher request status update
    app.patch(
      '/teacher-request-status/:id',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
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

          res.send({ message: 'updated' });
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: 'Failed to update' });
        }
      }
    );

    // control class
    app.get(
      '/admin-add-class',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const result = await classCollection.find().toArray();
        res.send(result);
      }
    );

    // class status control
    app.patch(
      '/class-request-status/:id',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;

        try {
          await classCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: { status: status },
            }
          );
          res.send({ message: 'updates class request' });
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: 'Failed to update' });
        }
      }
    );

    // TODO: teacher section ---> #3
    // save teacher request data in db
    app.post(
      '/teacher-request',
      verifyFirebaseToken,
      verifyTeacher,
      async (req, res) => {
        const teachOnData = req.body;
        teachOnData.status = 'pending';
        teachOnData.create_at = new Date().toISOString();
        teachOnData.last_request_at = new Date().toISOString();

        const email = teachOnData?.email;
        const alreadyRequest = await teacherRequestCollection.findOne({
          email,
        });
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
            .send({ message: 'Already exists', inserted: false });
        }

        const result = await teacherRequestCollection.insertOne(teachOnData);
        res.send(result);
      }
    );

    // get all class
    app.get(
      '/get-all-classes/:email',
      verifyFirebaseToken,
      async (req, res) => {
        const email = req.params.email;

        try {
          if (!email) {
            return res.status(400).send({ message: 'Email is required' });
          }

          const result = await classCollection.find({ email }).toArray();
          if (result.length === 0) {
            return res
              .status(404)
              .json({ message: 'No classes found for this email' });
          }

          res.status(200).json(result);
        } catch (error) {
          console.error('Error fetching classes:', error);
          res
            .status(500)
            .json({ message: 'Internal Server Error', error: error.message });
        }
      }
    );

    // add classes data save in database
    app.post(
      '/add-class',
      verifyFirebaseToken,
      verifyTeacher,
      async (req, res) => {
        const addClassData = req.body;
        console.log(addClassData);
        try {
          await classCollection.insertOne(addClassData);
          return res
            .status(200)
            .send({ message: 'Add class saved in db', inserted: false });
        } catch (error) {
          console.log(error);
          res.status(500).json({ error: error.message });
        }
      }
    );

    // TODO: universal --> #4
    // get all approve class
    app.get('/approved-classes', async (req, res) => {
      try {
        const approvedClasses = await classCollection
          .find({ status: 'approved' })
          .toArray();
        res.send(approvedClasses);
      } catch (error) {
        console.error('Error fetching approved classes:', error);
        res.status(500).send({ message: 'Failed to fetch approved classes' });
      }
    });

    // get user's role
    app.get('/user/role/:email', verifyFirebaseToken, async (req, res) => {
      const email = req.params.email;
      if (!email) {
        return res.status(400).send({ message: 'Email is required' });
      }
      const result = await usersCollection.findOne({ email });
      res.send(result);
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
