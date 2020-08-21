import express from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'
import mongoose from 'mongoose'
import crypto from 'crypto'
import bcrypt from 'bcrypt-nodejs'


// Setting up MongoDB database
const mongoUrl = process.env.MONGO_URL || "mongodb://localhost/authCharity"
mongoose.connect(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true })
mongoose.Promise = Promise

const User = mongoose.model('User', {
  name: {
    type: String,
    unique: true,
    required: true, 
    minlength: 2,
    maxlength: 20
  },
  email: {
    type: String, 
    unique: true,
    required: true
  },
  password: {
    type: String,
    required: true,
    minlength: 5
  },
  accessToken: {
    type: String,
    default: () => crypto.randomBytes(128).toString('hex')
  },
  budget: {
    type: Number, 
    default: 0
  },
  charities: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Charity"
  }]
})

const Charity = mongoose.model("Charity", {
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  projectId: {
    type: Number
  },
  projectTitle: {
    type: String
  },
  favoriteStatus: {
    type: Boolean,
    default: false
  }, 
  donationAmount: {
    type: Number,
    default: 0
  }
})


// Defines the port the app will run on. Defaults to 8080, but can be 
// overridden when starting the server. For example: PORT=9000 npm start
const port = process.env.PORT || 8081
const app = express()

// Add middlewares to enable cors and json body parsing
app.use(cors())
app.use(bodyParser.json())
// app.use((req, res, next) => {
//   res.header('Access-Control-Allow-Origin', '*')
//   next()
// })


const authenticateUser = async (req, res, next) => {
  const user = await User.findOne({ accessToken: req.header('Authorization')})
  if (user) {
    req.user = user
    next()
  } else {
    res.status(403).json({ message: "You need to login to access this page"})
  }
}


app.get('/', (req, res) => {
  res.send('Backend for charity project')
})

// Create user
app.post('/users', async (req, res) => {
  try {
    const { name, email, password, budget } = req.body 
    const user = new User({ name, email, budget, password: bcrypt.hashSync(password)})
    const saved = await user.save()
    res.status(201).json(saved)
  } catch (err) {
    res.status(400).json({ message: 'Could not create user', errors: err.errors })
  }
})

// Login session
app.post('/sessions', async (req, res) => {
  const user = await User.findOne({ email: req.body.email})
  if (user && bcrypt.compareSync(req.body.password, user.password)) {
    res.json({ name: user.name, userId: user._id, accessToken: user.accessToken })
  } else {
    // Failure because user doesn't exist or encrypted password doesn't match
    res.status(400).json({ notFound: true })
  }
})

// This will only be shown if the next()-function is called from the middleware
app.get('/secrets', authenticateUser)
app.get('/secrets', (req, res) => {
  res.json({ secret: 'This is a super secret message'})
})

app.get('/users/:userId', authenticateUser)
app.get('/users/:userId', (req, res) => {
  try {
    res.status(201).json(req.body.user)
  } catch (err) {
    res.status(400).json({ message: 'Could not find user', errors: err.errors})
  }
})

// Updating favorites for a logged-in user
app.put('/users/:userId', async (req, res) => {
  try {
    const { userId, projectId, projectTitle, favoriteStatus, donationAmount, budget } = req.body
    await User.updateOne({ '_id': userId }, req.body, { accessToken: req.header("Authorization")})
    const savedCharity = await Charity.findOne({ userId: req.body.userId, projectId: req.body.projectId })
    if (savedCharity) {
      const updated = await Charity.findOneAndUpdate({ userId: req.body.userId, projectId: req.body.projectId }, req.body, { new: true })
      res.status(201).json(updated)
    } else {
      const likedCharity = new Charity({ userId, projectId, projectTitle, favoriteStatus, donationAmount, budget })
      const saved = await likedCharity.save()
      await User.findOneAndUpdate(
        { _id: userId },
        { $push: { charities: saved}}
      )
      res.status(201).json(saved)
    }
  } catch (err) {
    res.status(400).json({ message: 'Could not add to favorites', errors: err.errors })
  }
})


// Get a list of all the users
app.get('/users', async (req, res) => {
  const { name } = req.query
  console.log("Search user")
  const nameRegex = new RegExp(name, "i")
  let otherUser
  try {
    if (name) {
      otherUser = await User.find({ name: nameRegex })
    } else {
      otherUser = await User.find()
    } 
    res.status(201).json(otherUser)
  } catch (err) {
    res.status(400).json({ message: 'error', errors: err.errors })
  }
})

// Get a list of another user's added favorites
app.get('/users/:userId/otherUser', async (req, res) => {
  try {
    const name = await User.findOne({ _id: req.params.userId })
    const otherUser = await Charity.find({ userId: req.params.userId })
    res.status(201).json({ otherUser, name: name.name })
  } catch (err) {
    res.status(400).json({ message: 'error', errors: err.errors })
  }
})

// Get user-specific lists with query "favorite" 
app.get('/users/:userId/charities', async (req, res) => {
  const { favoriteStatus, projectId } = req.query

  // Puts favoriteStatus-query into an object
  const buildFavoriteStatusQuery = (favoriteStatus) => {
    let findFavoriteStatus = {}
    if (favoriteStatus) {
      findFavoriteStatus.favoriteStatus = favoriteStatus
    }
    return findFavoriteStatus
  }

  if (!projectId) {
    const lists = await Charity.find({ userId: req.params.userId })
      .find(buildFavoriteStatusQuery(favoriteStatus))

    if (lists.length > 0) {
      res.json(lists)
    } else {
      res.status(404).json({ message: 'No projects added as favorites yet'})
    }
  } 
  if (projectId) {
    const favoriteCharity = await Charity.findOne({ userId: req.params.userId, projectId: projectId })
    res.json(favoriteCharity)
  }
})

// Get a user's projects with a donation amount larger than 0
app.get('/users/:userId/donations', async (req, res) => {
    const lists = await Charity.find({ userId: req.params.userId })
      .find({donationAmount: {$gt: 0}} )
    if (lists.length > 0) {
      res.json(lists)
    } else {
      res.status(404).json({ message: 'No projects added to budget yet'})
    }
})


// Get a user's budget
app.get('/users/:userId/budget', async (req, res) => {
  const user = await User.findOne({_id: req.params.userId})
  res.json(user.budget)
})


// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`)
})