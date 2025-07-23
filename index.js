require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const admin = require('firebase-admin');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
    const assignmentCollection = database.collection('assignment-question');
    const enrollCollection = database.collection('enrolled-classes');
    const reportCollection = database.collection('ter-report');

    // done: verify section ---> #1
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

    // done: admin section ---> #2
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
        // console.log(id, role);

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

    // done: HOME SECTION 6 DATA  ---> #3
    app.get('/top-enrolled-classes', async (req, res) => {
      try {
        const topClasses = await classCollection
          .find({ enrolled: { $gt: 0 } })
          .sort({ enrolled: -1 })
          .limit(6)
          .toArray();

        res.status(200).json(topClasses);
      } catch (error) {
        console.error('Error fetching top classes:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
      }
    });

    // done: teacher section ---> #4
    // save teacher request data in db
    app.post('/teacher-request', verifyFirebaseToken, async (req, res) => {
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
    });

    // get all class
    app.get(
      '/get-all-classes/:email',
      verifyFirebaseToken,
      verifyTeacher,
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

    // all enroll for Class Progress
    app.get(
      '/all-enrolled/:id',
      verifyFirebaseToken,
      verifyTeacher,
      async (req, res) => {
        const { id } = req.params;
        // console.log(id);
        try {
          const result = await classCollection.findOne({
            _id: new ObjectId(id),
          });
          res.send(result);
        } catch (error) {
          console.error('Error fetching classes:', error);
          res
            .status(500)
            .json({ message: 'Internal Server Error', error: error.message });
        }
      }
    );

    //assignment count
    app.get(
      '/all-assignment-count/:id',
      verifyFirebaseToken,
      verifyTeacher,
      async (req, res) => {
        const { id } = req.params;
        // console.log(id);
        try {
          const query = { classId: id };
          const total = await assignmentCollection.countDocuments(query);
          // console.log(total);
          res.send(total);
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
        // console.log(addClassData);
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

    // get data by id
    app.get('/update-data-find/:id', async (req, res) => {
      const { id } = req.params;
      try {
        const result = await classCollection.findOne({ _id: new ObjectId(id) });
        res.status(200).json(result);
      } catch (error) {
        console.error('Error fetching classes:', error);
        res
          .status(500)
          .json({ message: 'Internal Server Error', error: error.message });
      }
    });

    // update class all fields
    app.put('/update-class/:id', async (req, res) => {
      const { id } = req.params;
      const updatedData = req.body;
      try {
        const result = await classCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              ...updatedData,
            },
          }
        );

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Update failed', error: err });
      }
    });

    // create assignment
    app.post(
      '/add-assignment',
      verifyFirebaseToken,
      verifyTeacher,
      async (req, res) => {
        const assignmentData = req.body;
        assignmentData.create_at = new Date().toISOString();

        try {
          await assignmentCollection.insertOne(assignmentData);
          return res
            .status(200)
            .send({ message: 'Assignment saved in db', inserted: false });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      }
    );

    //class delete
    app.delete(
      '/my-class-delete/:id',
      verifyFirebaseToken,
      verifyTeacher,
      async (req, res) => {
        const { id } = req.params;
        // console.log(id);
        try {
          const result = await classCollection.deleteOne({
            _id: new ObjectId(id),
          });
          if (result.deletedCount === 1) {
            res.status(200).send({ message: 'Class deleted successfully' });
          } else {
            res.status(404).send({ message: 'Class not found' });
          }
        } catch (error) {
          console.error('Delete Error:', error);
          res.status(500).send({ message: 'Internal Server Error', error });
        }
      }
    );

    // done: universal --> #5
    // get a single plant from database
    app.get('/approved-class-details/:id', async (req, res) => {
      const id = req.params.id;

      const result = await classCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
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

    // done: pagination
    app.get('/approved-classes-pagination', async (req, res) => {
      const pageNo = parseInt(req.query.page);
      const limit = parseInt(req.query.limit) || 6;
      const skip = pageNo * limit;
      try {
        const query = { status: 'approved' };
        const total = await classCollection.countDocuments(query); //for filter
        const result = await classCollection
          .find(query)
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({
          total,
          pageNo,
          totalPages: Math.ceil(total / limit),
          data: result,
        });
      } catch (error) {
        res.status(500).send({ message: 'Server Error', error });
      }
    });

    // done: payment --> #6
    app.post(
      '/create-payment-intent',
      verifyFirebaseToken,
      async (req, res) => {
        const { courseId } = req.body;

        const classData = await classCollection.findOne({
          _id: new ObjectId(courseId),
        });
        if (!classData) {
          return res
            .status(404)
            .send({ message: 'Not found any classData by this class ID' });
        }

        const coursePriceCents = classData?.price * 100;
        // console.log(coursePriceCents);

        // stripe....
        try {
          const paymentIntent = await stripe.paymentIntents.create({
            amount: coursePriceCents,
            currency: 'usd',
            automatic_payment_methods: {
              enabled: true,
            },
          });
          // console.log(paymentIntent);

          res.send({ clientSecret: paymentIntent.client_secret });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      }
    );

    // saved enrolled data
    app.post('/enroll-info', verifyFirebaseToken, async (req, res) => {
      try {
        const courseData = req.body;
        courseData.create_at = new Date().toISOString();
        // console.log(courseData);

        const result = await enrollCollection.insertOne(courseData);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Not inserted data in database' });
      }
    });

    // update enrolled time
    app.patch('/enrolled-update/:id', verifyFirebaseToken, async (req, res) => {
      const { id } = req.params;
      // console.log(id);

      try {
        const filter = { _id: new ObjectId(id) };

        const updateDoc = {
          $inc: { enrolled: 1 },
        };

        const result = await classCollection.updateOne(filter, updateDoc);
        res.send({ message: 'Enrolled count updated', result });
      } catch (error) {
        res.status(500).send({ success: false, message: 'Server error' });
      }
    });

    // done: My enroll class -->7
    app.get('/my-all-classes/:email', verifyFirebaseToken, async (req, res) => {
      const email = req.params.email;

      try {
        if (!email) {
          return res.status(400).send({ message: 'Email is required' });
        }

        const enrollments = await enrollCollection
          .find({ studentEmail: email })
          .sort({ create_at: -1 }) // descending order
          .toArray();
        if (enrollments.length === 0) {
          return res
            .status(404)
            .json({ message: 'No classes found for this email' });
        }

        res.status(200).json(enrollments);
      } catch (error) {
        console.error('Error fetching classes:', error);
        res
          .status(500)
          .json({ message: 'Internal Server Error', error: error.message });
      }
    });

    // assignment get
    app.get('/assignment-get/:id', verifyFirebaseToken, async (req, res) => {
      const { id } = req.params;
      // console.log(id);
      try {
        if (!id) {
          return res.status(400).send({ message: 'Email is required' });
        }

        const assignmentData = await assignmentCollection
          .find({ classId: id })
          .sort({ create_at: -1 }) // descending order
          .toArray();

        res.status(200).json(assignmentData);
      } catch (error) {
        console.error('Error fetching classes:', error);
        res
          .status(500)
          .json({ message: 'Internal Server Error', error: error.message });
      }
    });

    // done: for assignment  ---> #8
    app.get(
      '/get-class-for-assignment/:id',
      verifyFirebaseToken,
      async (req, res) => {
        const { id } = req.params;

        try {
          const result = await classCollection.findOne({
            _id: new ObjectId(id),
          });
          res.json(result);
        } catch (error) {
          console.error('Error fetching classes:', error);
          res
            .status(500)
            .json({ message: 'Internal Server Error', error: error.message });
        }
      }
    );

    // done: TER section  ---> #9
    // assignment post
    app.post('/ter-review', async (req, res) => {
      const postData = req.body;
      try {
        postData.create_at = new Date().toISOString();
        // console.log(courseData);
        const result = await reportCollection.insertOne(postData);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Not inserted data in database' });
      }
    });

    // get ter report by teacher email
    app.get('/get-ter-report/:email', async (req, res) => {
      const email = req.params.email;
      // console.log('Requested TER for:', email);
      try {
        if (!email) {
          return res.status(400).send({ message: 'Email is required' });
        }

        const result = await reportCollection
          .find({ teacherMail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).json(result);
      } catch (error) {
        console.error('Error fetching TER reports:', error);
        res
          .status(500)
          .json({ message: 'Internal Server Error', error: error.message });
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
