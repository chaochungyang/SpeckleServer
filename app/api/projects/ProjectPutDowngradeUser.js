const winston = require( '../../../config/logger' )

const Project = require( '../../../models/Project' )
const DataStream = require( '../../../models/DataStream' )
const PermissionCheck = require( '../middleware/PermissionCheck' )

module.exports = async ( req, res ) => {
  if ( !req.params.projectId || !req.params.userId )
    return res.status( 400 ).send( { success: false, message: 'No projectId or userId provided.' } )

  try {
    let project = await PermissionCheck( req.user, 'write', await Project.findOne( { _id: req.params.projectId } ) )

    let operations = [ ],
      streamsToModify = [ ]

    let allOtherProjects = await Project.find( { 'streams': { $in: project.streams }, _id: { $ne: project._id } } )
    let allStreams = await DataStream.find( { streamId: { $in: project.streams } }, 'canWrite canRead streamId owner' )

    for ( let streamId of project.streams ) {
      let otherProjects = allOtherProjects.filter( project => project.streams.indexOf( streamId ) > -1 )
      let stream = allStreams.find( s => s.streamId === streamId )

      let otherCW = Array.prototype.concat( ...otherProjects.map( p => p.permissions.canWrite.map( id => id.toString( ) ) ) )
      // if userId is not in other's write permissions, if it is in the stream's current write permissions, and if it's not in the stream's current read permissions already
      if ( otherCW.indexOf( req.params.userId ) === -1 && stream.canWrite.indexOf( req.params.userId ) > -1 ) {
        streamsToModify.push( streamId )
      }
    }

    // The following pulls the userId from canWrite, and adds it to its canRead array.
    if ( streamsToModify.length > 0 )
      operations.push( DataStream.updateMany( { streamId: { $in: streamsToModify } }, { $pull: { canWrite: req.params.userId }, $addToSet: { canRead: req.params.userId } } ) )

    // project update stream permissions: pull out of canWrite, push into canRead
    project.permissions.canWrite.indexOf( req.params.userId ) > -1 ? project.permissions.canWrite.splice( project.permissions.canWrite.indexOf( req.params.userId ), 1 ) : null
    project.permissions.canRead.indexOf( req.params.userId ) === -1 ? project.permissions.canRead.push( req.params.userId ) : null

    await Promise.all( [ ...operations, project.save( ) ] )
    return res.send( { success: true, project: project, modifiedStreams: streamsToModify } )
  } catch ( err ) {
    winston.error( JSON.stringify( err ) )
    res.status( err.message.indexOf( 'authorised' ) >= 0 ? 401 : 404 ).send( { success: false, message: err.message } )
  }
}
